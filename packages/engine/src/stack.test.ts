import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { appliesTo, gatherRepoFacts } from "./applicability.js";
import { buildContext } from "./context.js";
import { runDetector } from "./detectors/run.js";
import { declaredStacks, detectStacks } from "./stack.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});
const repoWith = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "factory-stack-"));
  made.push(dir);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), contents, "utf8");
  }
  return dir;
};

describe("detectStacks", () => {
  it("reads manifests, including one level down in a monorepo", async () => {
    const dir = await repoWith({
      "backend/pyproject.toml": "[project]\nname='x'\n",
      "web/package.json": "{}",
      "web/tsconfig.json": "{}",
      "tools/go.mod": "module x\n\ngo 1.22\n",
    });
    expect(await detectStacks(buildContext(dir))).toEqual([
      "node",
      "typescript",
      "python",
      "go",
    ]);
  });

  it("is unknown (empty) for a repo with no manifest", async () => {
    const dir = await repoWith({ "index.html": "<p>hi</p>" });
    expect(await detectStacks(buildContext(dir))).toEqual([]);
  });

  it("adds what the profile declares, so an empty repo can be scaffolded", async () => {
    const dir = await repoWith({
      ".factory/profile.yml":
        "version: 1\nname: x\ntype: cli\nstack: [typescript]\n",
    });
    expect(await detectStacks(buildContext(dir))).toEqual([
      "node",
      "typescript",
    ]);
  });

  it("maps free-text stack entries", () => {
    expect(declaredStacks(["React", "postgres", "golang"])).toEqual([
      "node",
      "go",
    ]);
  });
});

const withApplies = (applies: Control["applies"]): Control =>
  ({ id: "a.b.c", lane: "development", applies }) as Control;

describe("repo-aware applicability", () => {
  it("applies stack controls without a profile, from detected stacks", async () => {
    const dir = await repoWith({ "requirements.txt": "flask==3.0.0\n" });
    const ts = withApplies({ stack: "typescript" });
    const py = withApplies({ stack: "python" });
    const facts = await gatherRepoFacts(buildContext(dir), [ts, py]);
    expect(appliesTo(ts, null, facts)).toBe(false);
    expect(appliesTo(py, null, facts)).toBe(true);
  });

  it("evaluates { file } predicates against the repo", async () => {
    const dir = await repoWith({ "go.mod": "module x\n" });
    const lock = withApplies({ file: "package.json|go.mod" });
    const iac = withApplies({ file: "**/*.tf" });
    const facts = await gatherRepoFacts(buildContext(dir), [lock, iac]);
    expect(appliesTo(lock, null, facts)).toBe(true);
    expect(appliesTo(iac, null, facts)).toBe(false);
  });

  it("still assumes a flag predicate holds when there is no profile", async () => {
    const pii = withApplies({ flag: "handles-pii" });
    expect(appliesTo(pii, null)).toBe(true);
  });
});

describe("any-of detector", () => {
  it("passes on any passing alternative and fails only when all fail", async () => {
    const dir = await repoWith({ "ruff.toml": "" });
    const ctx = buildContext(dir);
    const linter = {
      type: "any-of" as const,
      detect: [
        { type: "file-exists" as const, path: "eslint.config.js" },
        { type: "file-exists" as const, path: "ruff.toml" },
      ],
    };
    expect((await runDetector(ctx, linter)).status).toBe("pass");

    const missing = {
      type: "any-of" as const,
      detect: [
        { type: "file-exists" as const, path: "a.txt" },
        { type: "file-exists" as const, path: "b.txt" },
      ],
    };
    const result = await runDetector(ctx, missing);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("none of 2 alternatives passed");
  });
});

describe("file-matches `absent`", () => {
  it("fails a file that still holds the template placeholder", async () => {
    const dir = await repoWith({ CODEOWNERS: "* @OWNER\n" });
    const result = await runDetector(buildContext(dir), {
      type: "file-matches",
      path: "CODEOWNERS",
      pattern: "(?m)^\\s*[^#\\s]\\S*\\s+@[\\w./-]+",
      absent: "@OWNER\\b",
    });
    expect(result.status).toBe("fail");
    expect(result.message).toContain("placeholder");
  });
});
