import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
