import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { applyChanges } from "./apply.js";
import { mergeJsonGenerator } from "./merge-json.js";
import { mergeYamlGenerator } from "./merge-yaml.js";

const control = (fix: Control["fix"]): Control =>
  ({
    id: "c.x.y",
    title: "t",
    lane: "cicd",
    phase: "build",
    severity: "low",
    detect: [{ type: "file-exists", path: "x" }],
    evidence: "none",
    references: [{ name: "r", url: "https://e.com" }],
    rationale: "r",
    fix,
  }) as Control;

describe("merge generators", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-merge-"));
    made.push(d);
    return d;
  };

  it("merge-json adds a key to package.json, preserving other keys", async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, "package.json"),
      '{\n  "name": "demo",\n  "scripts": {\n    "build": "tsc"\n  }\n}\n',
      "utf8",
    );
    const changes = await mergeJsonGenerator(
      buildContext(dir),
      control({
        type: "merge-json",
        file: "package.json",
        path: "scripts.test",
        value: "vitest run",
      }),
    );
    await applyChanges(dir, changes, { mode: "write" });
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.build).toBe("tsc"); // untouched
    expect(pkg.name).toBe("demo");
  });

  it("merge-json preserves a CRLF file's line endings (no mixed EOL)", async () => {
    const dir = await tmp();
    // A Windows-checked-out file with CRLF throughout.
    await writeFile(
      join(dir, "package.json"),
      '{\r\n  "name": "demo",\r\n  "scripts": {\r\n    "build": "tsc"\r\n  }\r\n}\r\n',
      "utf8",
    );
    const changes = await mergeJsonGenerator(
      buildContext(dir),
      control({
        type: "merge-json",
        file: "package.json",
        path: "scripts.test",
        value: "vitest run",
      }),
    );
    const next = changes[0]?.type === "file" ? changes[0].contents : "";
    expect(next).toContain("vitest run");
    // The inserted region must use CRLF like the rest of the file — no lone \n.
    expect(/[^\r]\n/.test(next)).toBe(false);
    expect(next.includes("\r\n")).toBe(true);
  });

  it("merge-json is a no-op when the value already matches", async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, "tsconfig.json"),
      '{ "compilerOptions": { "strict": true } }\n',
      "utf8",
    );
    const changes = await mergeJsonGenerator(
      buildContext(dir),
      control({
        type: "merge-json",
        file: "tsconfig.json",
        path: "compilerOptions.strict",
        value: true,
      }),
    );
    expect(changes).toEqual([]);
  });

  it("merge-yaml sets a path, preserving other content and comments", async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, "ci.yml"),
      "# a workflow\nname: CI\non: [push]\n",
      "utf8",
    );
    const changes = await mergeYamlGenerator(
      buildContext(dir),
      control({
        type: "merge-yaml",
        file: "ci.yml",
        path: "permissions",
        value: { contents: "read" },
      }),
    );
    await applyChanges(dir, changes, { mode: "write" });
    const out = await readFile(join(dir, "ci.yml"), "utf8");
    expect(out).toContain("# a workflow"); // comment preserved
    expect(out).toContain("name: CI");
    expect(out).toContain("permissions:");
    expect(out).toContain("contents: read");
  });

  it("merge-yaml is a no-op when the value already matches", async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, "ci.yml"),
      "permissions:\n  contents: read\n",
      "utf8",
    );
    const changes = await mergeYamlGenerator(
      buildContext(dir),
      control({
        type: "merge-yaml",
        file: "ci.yml",
        path: "permissions",
        value: { contents: "read" },
      }),
    );
    expect(changes).toEqual([]);
  });

  it("merge generators do nothing without a value", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "ci.yml"), "name: CI\n", "utf8");
    expect(
      await mergeYamlGenerator(
        buildContext(dir),
        control({ type: "merge-yaml", file: "ci.yml", path: "jobs.ci.steps" }),
      ),
    ).toEqual([]);
  });

  it("never fabricates an absent target file (safe no-op)", async () => {
    const dir = await tmp();
    // No package.json / ci.yml exists in this repo.
    const json = await mergeJsonGenerator(
      buildContext(dir),
      control({
        type: "merge-json",
        file: "package.json",
        path: "scripts.test",
        value: "vitest run",
      }),
    );
    const yaml = await mergeYamlGenerator(
      buildContext(dir),
      control({
        type: "merge-yaml",
        file: ".github/workflows/ci.yml",
        path: "permissions",
        value: { contents: "read" },
      }),
    );
    expect(json).toEqual([]);
    expect(yaml).toEqual([]);
    // And nothing was written.
    await expect(readFile(join(dir, "package.json"), "utf8")).rejects.toThrow();
  });

  // A hand-edited CI workflow with a top comment, a flow collection, and two
  // existing steps — the realistic target for an append-if-missing step fix.
  const CI_WORKFLOW = `# a hand-written workflow
name: CI
on:
  push:
    branches: [main]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build # keep this
        run: npm run build
`;

  const appendControl = (
    value: unknown,
    extra: Record<string, unknown> = {},
  ): Control =>
    control({
      type: "merge-yaml",
      file: "ci.yml",
      path: "jobs.ci.steps",
      mergeStrategy: "append-if-missing",
      dedupeKey: "name",
      value,
      ...extra,
    } as Control["fix"]);

  describe("merge-yaml append-if-missing", () => {
    it("appends a missing step without clobbering existing steps or comments", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), CI_WORKFLOW, "utf8");
      const changes = await mergeYamlGenerator(
        buildContext(dir),
        appendControl({ name: "Test", run: "npm test --if-present" }),
      );
      await applyChanges(dir, changes, { mode: "write" });
      const out = await readFile(join(dir, "ci.yml"), "utf8");
      // The new step is present...
      expect(out).toContain("name: Test");
      expect(out).toContain("run: npm test --if-present");
      // ...and every existing step and comment survives.
      expect(out).toContain("# a hand-written workflow");
      expect(out).toContain("uses: actions/checkout@v4");
      expect(out).toContain("name: Build # keep this");
      expect(out).toContain("run: npm run build");
    });

    it("is idempotent: re-running adds nothing (dedup by key)", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), CI_WORKFLOW, "utf8");
      const ctl = appendControl({ name: "Test", run: "npm test --if-present" });
      const first = await mergeYamlGenerator(buildContext(dir), ctl);
      await applyChanges(dir, first, { mode: "write" });
      // Second run against the now-updated file produces no change.
      const second = await mergeYamlGenerator(buildContext(dir), ctl);
      expect(second).toEqual([]);
    });

    it("does not re-add a step that already exists (matched by dedupeKey)", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), CI_WORKFLOW, "utf8");
      // "Build" already exists in the fixture.
      const changes = await mergeYamlGenerator(
        buildContext(dir),
        appendControl({ name: "Build", run: "something else" }),
      );
      expect(changes).toEqual([]);
    });

    it("appends a list of steps, adding only the missing ones", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), CI_WORKFLOW, "utf8");
      const changes = await mergeYamlGenerator(
        buildContext(dir),
        appendControl([
          { name: "Build", run: "dup" }, // already present → skipped
          { name: "Lint", run: "npm run lint --if-present" }, // new → added
        ]),
      );
      await applyChanges(dir, changes, { mode: "write" });
      const out = await readFile(join(dir, "ci.yml"), "utf8");
      expect(out).toContain("name: Lint");
      // Build appears exactly once (not duplicated).
      expect(out.match(/name: Build/g)?.length).toBe(1);
    });

    it("selects the per-stack fragment from the profile (byStack)", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), CI_WORKFLOW, "utf8");
      await mkdir(join(dir, ".factory"), { recursive: true });
      await writeFile(
        join(dir, ".factory", "profile.yml"),
        "version: 1\nname: demo\ntype: library\nstack: [python]\n",
        "utf8",
      );
      const changes = await mergeYamlGenerator(
        buildContext(dir),
        appendControl(undefined, {
          byStack: {
            node: { name: "Test", run: "npm test --if-present" },
            python: { name: "Test", run: "pytest" },
          },
        }),
      );
      await applyChanges(dir, changes, { mode: "write" });
      const out = await readFile(join(dir, "ci.yml"), "utf8");
      expect(out).toContain("run: pytest");
      expect(out).not.toContain("npm test");
    });
  });

  describe("merge-yaml round-trip fidelity (#59)", () => {
    it("leaves an untouched flow collection verbatim (no padding)", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), CI_WORKFLOW, "utf8");
      const changes = await mergeYamlGenerator(
        buildContext(dir),
        control({
          type: "merge-yaml",
          file: "ci.yml",
          path: "permissions",
          value: { contents: "read" },
        }),
      );
      const next = changes[0]?.type === "file" ? changes[0].contents : "";
      // The untouched `branches: [main]` is not reformatted to `[ main ]`.
      expect(next).toContain("branches: [main]");
      expect(next).not.toContain("[ main ]");
    });

    it("preserves a leading BOM", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "ci.yml"), `\uFEFF${CI_WORKFLOW}`, "utf8");
      const changes = await mergeYamlGenerator(
        buildContext(dir),
        control({
          type: "merge-yaml",
          file: "ci.yml",
          path: "permissions",
          value: { contents: "read" },
        }),
      );
      const next = changes[0]?.type === "file" ? changes[0].contents : "";
      expect(next.charCodeAt(0)).toBe(0xfeff);
    });
  });
});
