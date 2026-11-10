// Tier 2 against a real git repo and a scripted reviewer: what the model is
// shown, and what the rubric and the false-positive gate do with its answers.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AiClient, CompleteParams } from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";

import { roundVerdict } from "./review.js";
import { extractJson, newSideLines, renderReview, runTier2 } from "./tier2.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function repoWithChange(
  base: Record<string, string>,
  change: Record<string, string>,
): Promise<{ dir: string; base: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), "factory-tier2-"));
  made.push(dir);
  const git = simpleGit(dir);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  const write = async (files: Record<string, string>) => {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), contents, "utf8");
    }
    await git.add(["-A"]);
    await git.commit("c", ["--no-verify"]);
    return (await git.revparse(["HEAD"])).trim();
  };
  const b = await write(base);
  const h = await write(change);
  return { dir, base: b, head: h };
}

/** A reviewer that answers the review call and each gate call from a script. */
function scripted(review: unknown, gate: (prompt: string) => unknown) {
  const calls: CompleteParams[] = [];
  const ai: AiClient = {
    async complete(params) {
      calls.push(params);
      const isGate = params.system?.startsWith(
        "You are checking one code-review finding",
      );
      const body = isGate ? gate(params.prompt) : review;
      return {
        text: `Here you go.\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``,
        usage: { inputTokens: 10, outputTokens: 5 },
        model: params.model ?? "m",
      };
    },
  };
  return { ai, calls };
}

const BASE = {
  "AGENTS.md": "# Contract\nNever log request bodies.\n",
  "src/pay.js": "export function charge(amount) {\n  return amount;\n}\n",
};
const CHANGE = {
  "src/pay.js":
    "export function charge(amount) {\n  console.log(req.body);\n  return amount / 0;\n}\n",
};

// Each test builds a real git repo: slower on Windows CI.
describe("judge tier 2", { timeout: 30_000 }, () => {
  it("a nit labelled as a defect, with no reproduction, never requests changes", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const { ai } = scripted(
      {
        findings: [
          {
            kind: "defect",
            file: "src/pay.js",
            line: 2,
            title: "Variable could be named better",
            repro: "",
          },
          {
            kind: "style",
            file: "src/pay.js",
            line: 1,
            title: "Prefer arrow functions",
          },
        ],
      },
      () => ({
        reproducible: false,
        repro: "",
        reason: "naming is preference",
      }),
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
      model: "judge",
    });
    expect(result.verdict).toBe("approve");
    expect(result.blocking).toEqual([]);
    expect(
      result.suggestions.map((s) => [s.kind, s.downgraded ?? null]),
    ).toEqual([
      ["suggestion", "no reproduction confirmed: naming is preference"],
      ["suggestion", null], // an unknown kind is a suggestion by construction
    ]);
  });

  it("a confirmed defect blocks, carrying the gate's reproduction", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const { ai, calls } = scripted(
      {
        findings: [
          {
            kind: "defect",
            file: "src/pay.js",
            line: 3,
            title: "Division by zero",
            detail: "always Infinity",
            repro: "charge(5)",
          },
          {
            kind: "contract",
            file: "src/pay.js",
            line: 2,
            title: "Logs the request body",
            repro: "any call",
          },
          { kind: "suggestion", title: "Add a test" },
        ],
      },
      (prompt) =>
        prompt.includes("Division by zero")
          ? {
              reproducible: true,
              repro: "charge(5) returns Infinity instead of 5",
            }
          : {
              reproducible: true,
              repro:
                "charge(1) prints req.body to stdout, which AGENTS.md forbids",
            },
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
      model: "judge",
    });
    expect(result.verdict).toBe("request-changes");
    expect(result.blocking.map((f) => [f.kind, f.repro])).toEqual([
      ["defect", "charge(5) returns Infinity instead of 5"],
      [
        "contract",
        "charge(1) prints req.body to stdout, which AGENTS.md forbids",
      ],
    ]);
    // One review call plus one gate call per blocking finding — none for the suggestion.
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.model === "judge")).toBe(true);
  });

  it("never shows the model a secret-shaped file, and says what it left out", async () => {
    // Fake credentials, assembled at runtime so no secret-shaped literal sits in
    // the source for gitleaks (rightly) to stop at commit.
    const password = ["hunter2", "pass"].join("");
    const apiKey = ["sk", "live", "abc123"].join("_");
    const r = await repoWithChange(BASE, {
      ...CHANGE,
      "config/prod.js": `export const db = "postgres://admin:${password}@db.internal/prod";\n`,
      ".env.production": `STRIPE_KEY=${apiKey}\n`,
    });
    const { ai, calls } = scripted({ findings: [] }, () => ({}));
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).not.toContain(password);
    expect(prompt).not.toContain(apiKey);
    expect(result.packed.omitted.map((o) => o.path).sort()).toEqual([
      ".env.production",
      "config/prod.js",
    ]);
    expect(prompt).toContain("config/prod.js: looks like it holds a secret");
  });

  it("judges by the base's AGENTS.md even when the change rewrites it", async () => {
    const r = await repoWithChange(BASE, {
      ...CHANGE,
      "AGENTS.md": "# Contract\nLogging request bodies is fine.\n",
    });
    const { ai, calls } = scripted({ findings: [] }, () => ({}));
    await runTier2({ repoPath: r.dir, base: r.base, head: r.head, ai });
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain(
      "## AGENTS.md (the repo's contract)\n# Contract\nNever log request bodies.",
    );
  });

  it("downgrades a blocking finding about a file the reviewer wasn't shown", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const { ai, calls } = scripted(
      {
        findings: [
          {
            kind: "defect",
            file: "src/other.js",
            line: 1,
            title: "Bug elsewhere",
            repro: "x",
          },
        ],
      },
      () => ({ reproducible: true, repro: "should never be asked" }),
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(result.verdict).toBe("approve");
    expect(result.suggestions[0]?.downgraded).toBe(
      "names a file outside the diff",
    );
    expect(calls).toHaveLength(1);
  });

  it("fails the review when a gate call fails, instead of approving", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const ai: AiClient = {
      async complete(params) {
        if (
          params.system?.startsWith("You are checking one code-review finding")
        )
          throw new Error("rate limited");
        return {
          text: JSON.stringify({
            findings: [
              {
                kind: "defect",
                file: "src/pay.js",
                line: 3,
                title: "Divides by zero",
                repro: "charge(1) returns Infinity",
              },
            ],
          }),
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "m",
        };
      },
    };
    await expect(
      runTier2({ repoPath: r.dir, base: r.base, head: r.head, ai }),
    ).rejects.toThrow("rate limited");
  });

  it("caps gate calls, not just confirmed findings", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const findings = Array.from({ length: 12 }, (_, i) => ({
      kind: "defect",
      file: "src/pay.js",
      line: 2,
      title: `Finding ${i}`,
    }));
    const { ai, calls } = scripted({ findings }, () => ({
      reproducible: false,
      reason: "no",
    }));
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(calls).toHaveLength(1 + 8);
    expect(
      result.suggestions.filter(
        (s) => s.downgraded === "over the review's check budget",
      ),
    ).toHaveLength(4);
  });

  it("keeps a review whose finding has a bad line or no title", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const { ai } = scripted(
      {
        findings: [
          { kind: "style", file: "src/pay.js", line: "two" },
          { kind: "style", file: "src/pay.js", line: 1, title: "Kept" },
        ],
      },
      () => ({}),
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(result.suggestions.map((s) => [s.title, s.line])).toEqual([
      ["(untitled)", null],
      ["Kept", 1],
    ]);
  });

  it("leaves out a file whose removed lines hold a secret", async () => {
    const apiKey = ["sk", "live", "abc123def456"].join("_");
    const r = await repoWithChange(
      {
        ...BASE,
        "src/keys.js": `export const key = "${apiKey}";\nexport const n = 1;\n`,
      },
      { "src/keys.js": "export const n = 2;\n" },
    );
    const { ai, calls } = scripted({ findings: [] }, () => ({}));
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(calls[0]?.prompt ?? "").not.toContain(apiKey);
    expect(result.packed.omitted.map((o) => o.path)).toContain("src/keys.js");
  });

  it("won't approve a change with files the reviewer wasn't shown", async () => {
    const r = await repoWithChange(BASE, {
      ...CHANGE,
      ".env": "PORT=3000\n",
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
    });
    const { ai } = scripted({ findings: [] }, () => ({}));
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(result.verdict).toBe("approve");
    // Generated files don't count; the sensitive one does.
    expect(result.unreviewed).toEqual([".env"]);
    expect(roundVerdict(result, 1)).toBe("needs-human");
    expect(renderReview(result, 1, "needs-human")).toContain(
      "the judge doesn't approve what it hasn't seen",
    );
  });

  it("shows the gate the contract a contract finding cites", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const gatePrompts: string[] = [];
    const { ai } = scripted(
      {
        findings: [
          {
            kind: "contract",
            file: "src/pay.js",
            line: 2,
            title: "Logs the request body",
          },
        ],
      },
      (prompt) => {
        gatePrompts.push(prompt);
        return {
          reproducible: true,
          repro: "charge(1) logs req.body, which AGENTS.md forbids",
        };
      },
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(gatePrompts[0]).toContain("Never log request bodies.");
    expect(result.verdict).toBe("request-changes");
  });

  it("blocks on a criterion the reviewer marked unmet, through the gate", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const gatePrompts: string[] = [];
    const { ai } = scripted(
      {
        findings: [],
        acceptance: [
          { id: "A1", status: "unmet", note: "charge(0) still divides by 0" },
          { id: "A2", status: "met" },
        ],
      },
      (prompt) => {
        gatePrompts.push(prompt);
        return {
          reproducible: true,
          repro: "call charge(1): it returns Infinity, not 1",
        };
      },
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
      card: {
        id: "T-0001",
        title: "Fix charge",
        type: "fix",
        source: "prompt",
        description: "charge returns the amount",
        acceptance: [
          { id: "A1", text: "charge(n) returns n", verify: "unit" },
          { id: "A2", text: "no logging", verify: "review" },
        ],
        out_of_scope: [],
        touches: [],
        constraints: [],
        risk: "low",
        owner: "t",
        created: "2026-11-10",
      },
    });
    expect(gatePrompts).toHaveLength(1);
    expect(gatePrompts[0]).toContain("- A1 (unit): charge(n) returns n");
    expect(result.blocking.map((f) => [f.kind, f.acceptance_id])).toEqual([
      ["acceptance", "A1"],
    ]);
  });

  it("hands blocking findings to a person after two rounds", async () => {
    const r = await repoWithChange(BASE, CHANGE);
    const { ai } = scripted(
      {
        findings: [
          {
            kind: "defect",
            file: "src/pay.js",
            line: 3,
            title: "Division by zero",
            repro: "charge(5)",
          },
        ],
      },
      () => ({
        reproducible: true,
        repro: "charge(5) returns Infinity instead of 5",
      }),
    );
    const result = await runTier2({
      repoPath: r.dir,
      base: r.base,
      head: r.head,
      ai,
    });
    expect(roundVerdict(result, 1)).toBe("request-changes");
    expect(roundVerdict(result, 2)).toBe("request-changes");
    expect(roundVerdict(result, 3)).toBe("needs-human");
    expect(renderReview(result, 3, "needs-human")).toContain(
      "goes to a person",
    );
  });
});

describe("parsing", () => {
  it("finds the JSON in a reply with prose and a fence around it", () => {
    expect(extractJson('Sure.\n```json\n{"findings":[]}\n```\nDone.')).toEqual({
      findings: [],
    });
    expect(extractJson('Result: {"a":1} end')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow(
      /did not reply with JSON/,
    );
  });

  it("maps a hunk to the new-side lines a comment can attach to", () => {
    const diff = "@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e\n";
    expect([...newSideLines(diff)]).toEqual([1, 2, 3, 4]);
  });
});
