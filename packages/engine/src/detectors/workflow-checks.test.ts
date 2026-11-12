// The CI/security controls read workflow structure, not keywords: these run the
// real catalog controls against small repos.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadBundledCatalog } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateControls } from "../audit.js";
import { buildContext } from "../context.js";
import { applyChanges } from "../generators/apply.js";
import { mergeYamlGenerator } from "../generators/merge-yaml.js";
import { renderTemplate, templateVars } from "../generators/template.js";
import { runDetector } from "./run.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});
const repoWith = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "factory-wf-"));
  made.push(dir);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), contents, "utf8");
  }
  return dir;
};

async function statuses(dir: string, prefix: RegExp) {
  const { controls } = await loadBundledCatalog();
  const selected = controls.filter((c) => prefix.test(c.id));
  const results = await evaluateControls(selected, buildContext(dir), {
    profile: null,
    waivers: [],
  });
  return Object.fromEntries(results.map((r) => [r.controlId, r.status]));
}

const FACTORY_YML = `name: factory
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: factory
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - name: Secret scan
        run: gitleaks git
      - run: npm test
`;

describe("CI controls read workflow structure", () => {
  it("a repo whose only workflow is factory.yml passes no ci.* or CI security control", async () => {
    const dir = await repoWith({
      ".github/workflows/factory.yml": FACTORY_YML,
    });
    const result = await statuses(
      dir,
      /^(ci\.|sec\.(sast|sbom|secret-scanning|dependency-scan)\.ci|dev\.linter\.in-ci|test\.runner\.in-ci)/,
    );
    expect(Object.entries(result).filter(([, s]) => s === "pass")).toEqual([]);
  });

  it("write-all fails workflow permissions; every workflow must declare them", async () => {
    const perms = (body: string) =>
      repoWith({
        ".github/workflows/ci.yml": `on: [pull_request]\n${body}jobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n`,
      });
    const ok = await statuses(
      await perms("permissions:\n  contents: read\n"),
      /^ci\.workflow-permissions$/,
    );
    const writeAll = await statuses(
      await perms("permissions: write-all\n"),
      /^ci\.workflow-permissions$/,
    );
    const missing = await statuses(
      await perms(""),
      /^ci\.workflow-permissions$/,
    );
    expect(ok["ci.workflow-permissions"]).toBe("pass");
    expect(writeAll["ci.workflow-permissions"]).toBe("fail");
    expect(missing["ci.workflow-permissions"]).toBe("fail");
  });

  it("requires every action pinned, and --if-present doesn't count as running tests", async () => {
    const dir = await repoWith({
      "package.json": "{}",
      ".github/workflows/ci.yml": `on: [pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: step-security/harden-runner@91182cccc01eb5e619899d80e4e971d6181294a7
      - run: npm test --if-present
`,
    });
    const result = await statuses(
      dir,
      /^(ci\.actions-pinned-sha|test\.runner\.in-ci)$/,
    );
    expect(result).toEqual({
      "ci.actions-pinned-sha": "fail",
      "test.runner.in-ci": "fail",
    });
  });

  it("a keyword in a comment no longer satisfies SAST", async () => {
    const dir = await repoWith({
      ".github/workflows/ci.yml": `# TODO: add codeql and semgrep
on: [pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`,
    });
    expect((await statuses(dir, /^sec\.sast\.ci$/))["sec.sast.ci"]).toBe(
      "fail",
    );
  });
});

describe("reviewed detector", () => {
  const draft = (task: string, reviewer: string) =>
    `<!-- factory:generated\ntask: ${task}\nreviewed-by:${reviewer}\n-->\n\n# Doc\n`;
  const check = async (files: Record<string, string>, task?: string) =>
    runDetector(
      buildContext(await repoWith(files)),
      task ? { type: "reviewed", task } : { type: "reviewed" },
    );

  it("passes human-written files and reviewed drafts", async () => {
    const result = await check({
      "docs/brief.md": draft("brief", " @arynbht"),
      "docs/notes.md": "# Written by hand\n",
    });
    expect(result.status).toBe("pass");
  });

  it("fails on any unreviewed draft, even beside reviewed and human files", async () => {
    const result = await check({
      "docs/adr/0001-a.md": draft("adr", " @arynbht"),
      "docs/adr/0002-b.md": draft("adr", ""),
      "docs/adr/README.md": "# ADRs\n",
    });
    expect(result.status).toBe("fail");
    expect(result.message).toContain("docs/adr/0002-b.md");
  });

  it("finds drafts by header, wherever they live, scoped to the task", async () => {
    const files = {
      "anywhere/odd-name.md": draft("brief", ""),
      "docs/adr/0001-a.md": draft("adr", " @arynbht"),
    };
    expect((await check(files, "brief")).status).toBe("fail");
    expect((await check(files, "adr")).status).toBe("pass");
  });
});

describe("the Node CI the factory writes", () => {
  const IN_CI = /^(dev\.linter|test\.runner)\.in-ci$/;
  const node = (scripts: Record<string, string>) =>
    JSON.stringify({ name: "demo", scripts });

  it("passes the CI controls when the repo has the scripts, and only runs those", async () => {
    const scripts = { lint: "eslint .", typecheck: "tsc", test: "vitest run" };
    const [ci] = await renderTemplate(
      "ci-workflow",
      templateVars(null, 2026, {
        stack: ["node"],
        scripts: Object.keys(scripts),
      }),
      "ci.workflow.present",
    );
    const contents = ci?.type === "file" ? ci.contents : "";
    expect(contents).not.toContain("--if-present");
    expect(contents).toContain("run: npm run typecheck");
    const dir = await repoWith({
      "package.json": node(scripts),
      ".github/workflows/ci.yml": contents,
    });
    expect(await statuses(dir, IN_CI)).toEqual({
      "dev.linter.in-ci": "pass",
      "test.runner.in-ci": "pass",
    });

    // No scripts: no check steps, so the controls say so instead of passing.
    const [bare] = await renderTemplate(
      "ci-workflow",
      templateVars(null, 2026, { stack: ["node"], scripts: [] }),
      "ci.workflow.present",
    );
    const bareContents = bare?.type === "file" ? bare.contents : "";
    expect(bareContents).not.toMatch(/name: (Lint|Typecheck|Test)/);
    const empty = await repoWith({
      "package.json": node({}),
      ".github/workflows/ci.yml": bareContents,
    });
    expect(Object.values(await statuses(empty, IN_CI))).toEqual([
      "fail",
      "fail",
    ]);
  });

  it("adds real steps beside ones that can't fail, so one fix run passes", async () => {
    const dir = await repoWith({
      "package.json": node({ lint: "eslint .", test: "vitest run" }),
      ".github/workflows/ci.yml": `name: CI
on: [pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - name: Lint
        run: npm run lint --if-present
      - name: Test
        run: npm test --if-present
`,
    });
    expect(Object.values(await statuses(dir, IN_CI))).toEqual(["fail", "fail"]);
    const { controls } = await loadBundledCatalog();
    for (const control of controls.filter((c) => IN_CI.test(c.id))) {
      const changes = await mergeYamlGenerator(buildContext(dir), control);
      await applyChanges(dir, changes, { mode: "write" });
    }
    expect(await statuses(dir, IN_CI)).toEqual({
      "dev.linter.in-ci": "pass",
      "test.runner.in-ci": "pass",
    });
  });
});

describe("command detector", () => {
  it("skips unless the context allows running commands", async () => {
    const dir = await repoWith({ "package.json": "{}" });
    const config = { type: "command" as const, run: "node --version" };
    expect((await runDetector(buildContext(dir), config)).status).toBe("skip");
    expect(
      (await runDetector(buildContext(dir, { runCommands: true }), config))
        .status,
    ).toBe("pass");
  });

  it("runs the command for the detected stack", async () => {
    const dir = await repoWith({ "package.json": "{}" });
    const result = await runDetector(buildContext(dir, { runCommands: true }), {
      type: "command",
      byStack: { node: "node -e process.exit(3)", python: "pytest" },
    });
    expect(result.status).toBe("fail");
    expect(result.message).toContain("exited 3");
  });
});
