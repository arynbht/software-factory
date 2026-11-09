// Fixes against repos the factory did not scaffold: a CI job not named `ci`,
// several merges into one file in a single run, and values a human already set.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { buildContext } from "../context.js";
import { applyChanges } from "./apply.js";
import { mergeJsonGenerator } from "./merge-json.js";
import { mergeYamlGenerator } from "./merge-yaml.js";
import { planControls } from "./run.js";

const control = (id: string, fix: Control["fix"]): Control =>
  ({
    id,
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

const step = (id: string, name: string): Control =>
  control(id, {
    type: "merge-yaml",
    file: ".github/workflows/ci.yml",
    path: "jobs.ci.steps",
    mergeStrategy: "append-if-missing",
    dedupeKey: "name",
    value: { name, run: `echo ${name}` },
  } as Control["fix"]);

// A hand-written workflow whose job is named `build`, with a comment to keep.
const BUILD_JOB = `name: CI
on: [pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # run the suite
      - run: npm test
`;

describe("fixes on repos the factory did not scaffold", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const repoWith = async (files: Record<string, string>): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "factory-real-"));
    made.push(dir);
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), contents, "utf8");
    }
    return dir;
  };
  const ci = (dir: string) =>
    readFile(join(dir, ".github/workflows/ci.yml"), "utf8");

  it("adds a step to the job named `build`, changing nothing else", async () => {
    const dir = await repoWith({ ".github/workflows/ci.yml": BUILD_JOB });
    const changes = await mergeYamlGenerator(
      buildContext(dir),
      step("sec.sast.ci", "SAST"),
    );
    await applyChanges(dir, changes, { mode: "write" });

    const out = await ci(dir);
    expect(out.startsWith(BUILD_JOB)).toBe(true); // every original line intact
    expect(out).toContain("# run the suite");
    const doc = parse(out) as { jobs: Record<string, { steps: unknown[] }> };
    expect(Object.keys(doc.jobs)).toEqual(["build"]); // no invented `ci` job
    expect(doc.jobs.build?.steps).toHaveLength(3);
  });

  it("prefers ci/build/test when several jobs check out code", async () => {
    const dir = await repoWith({
      ".github/workflows/ci.yml": `jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`,
    });
    const changes = await mergeYamlGenerator(
      buildContext(dir),
      step("sec.sast.ci", "SAST"),
    );
    await applyChanges(dir, changes, { mode: "write" });
    const doc = parse(await ci(dir)) as {
      jobs: Record<string, { steps: unknown[] }>;
    };
    expect(doc.jobs.test?.steps).toHaveLength(2);
    expect(doc.jobs.docs?.steps).toHaveLength(1);
  });

  it("writes a suggestion instead of guessing when the job is ambiguous", async () => {
    const workflow = `jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const dir = await repoWith({ ".github/workflows/ci.yml": workflow });
    const changes = await mergeYamlGenerator(
      buildContext(dir),
      step("sec.sast.ci", "SAST"),
    );
    expect(changes[0]).toMatchObject({ type: "file", op: "suggest" });
    const results = await applyChanges(dir, changes, { mode: "write" });

    expect(results[0]?.action).toBe("suggest");
    expect(await ci(dir)).toBe(workflow); // untouched
    const suggested = await readFile(
      join(dir, ".github/workflows/ci.yml.factory-suggested"),
      "utf8",
    );
    expect(suggested).toContain("several jobs could take this step");
    expect(suggested).toContain("name: SAST");
  });

  it("lands every merge into one file in a single run, and the next run is a no-op", async () => {
    const dir = await repoWith({ ".github/workflows/ci.yml": BUILD_JOB });
    const controls = [
      step("a.b.one", "One"),
      step("a.b.two", "Two"),
      step("a.b.three", "Three"),
    ];

    const first = await planControls(buildContext(dir), controls);
    await applyChanges(dir, first.changes, { mode: "write" });
    const doc = parse(await ci(dir)) as {
      jobs: { build: { steps: { name?: string }[] } };
    };
    expect(doc.jobs.build.steps.map((s) => s.name).filter(Boolean)).toEqual([
      "One",
      "Two",
      "Three",
    ]);

    const second = await planControls(buildContext(dir), controls);
    expect(second.changes).toEqual([]);
  });

  it("merges into a file a template creates earlier in the same run", async () => {
    const dir = await repoWith({});
    const create = control("a.b.create", {
      type: "merge-json",
      file: "tsconfig.json",
      path: "compilerOptions.strict",
      value: true,
      createIfMissing: true,
    } as Control["fix"]);
    const add = control("a.b.add", {
      type: "merge-json",
      file: "tsconfig.json",
      path: "compilerOptions.noEmit",
      value: true,
    } as Control["fix"]);

    const { changes } = await planControls(buildContext(dir), [create, add]);
    await applyChanges(dir, changes, { mode: "write" });
    const tsconfig = JSON.parse(
      await readFile(join(dir, "tsconfig.json"), "utf8"),
    );
    expect(tsconfig).toEqual({
      compilerOptions: { strict: true, noEmit: true },
    });
  });

  it("never overwrites a value a human set; suggests instead", async () => {
    const pkg = '{\n  "scripts": {\n    "test": "pytest"\n  }\n}\n';
    const dir = await repoWith({ "package.json": pkg });
    const changes = await mergeJsonGenerator(
      buildContext(dir),
      control("a.b.c", {
        type: "merge-json",
        file: "package.json",
        path: "scripts.test",
        value: "vitest run",
      } as Control["fix"]),
    );
    await applyChanges(dir, changes, { mode: "write" });
    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(pkg);
    expect(
      await readFile(join(dir, "package.json.factory-suggested"), "utf8"),
    ).toContain("vitest run");
  });
});
