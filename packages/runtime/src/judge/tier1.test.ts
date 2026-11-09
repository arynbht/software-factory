// Tier 1 end to end on a real git repo: no mocks for git, the clone, or the
// checks. The repo's "lint" fails when any source file contains `BAD`.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";

import { runTier1 } from "./tier1.js";

const LINT = `const fs = require("fs");
const bad = fs.readdirSync("src").filter((f) => fs.readFileSync("src/" + f, "utf8").includes("BAD"));
if (bad.length) { console.error("lint: BAD in " + bad.join(", ")); process.exit(1); }
`;

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function repo(): Promise<{
  dir: string;
  commit: (msg: string) => Promise<void>;
  write: (p: string, c: string) => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "factory-judge-test-"));
  made.push(dir);
  const git = simpleGit(dir);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.addConfig("core.autocrlf", "false");
  const write = async (path: string, contents: string) => {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), contents, "utf8");
  };
  const commit = async (msg: string) => {
    await git.add(["-A"]);
    await git.commit(msg, ["--no-verify"]);
  };
  await write(
    "package.json",
    JSON.stringify(
      {
        name: "demo",
        private: true,
        scripts: { lint: "node lint.cjs", test: 'node -e ""' },
      },
      null,
      2,
    ),
  );
  await write("lint.cjs", LINT);
  await write("src/app.js", "module.exports = 1;\n");
  await commit("base");
  await git.branch(["base"]);
  await git.checkoutLocalBranch("change");
  return { dir, commit, write };
}

const judge = (dir: string) =>
  runTier1({ repoPath: dir, base: "base", install: false });

describe("judge tier 1", () => {
  it("passes a change that keeps the checks green", async () => {
    const r = await repo();
    await r.write("src/feature.js", "module.exports = 2;\n");
    await r.commit("feature");
    const result = await judge(r.dir);
    expect(result.verdict).toBe("pass");
    expect(
      result.checks.find((c) => c.id === "quality.lint.clean")?.outcome,
    ).toBe("pass");
  }, 60_000);

  it("fails a change that breaks a check", async () => {
    const r = await repo();
    await r.write("src/feature.js", "// BAD\n");
    await r.commit("feature");
    const result = await judge(r.dir);
    expect(result.verdict).toBe("fail");
    expect(
      result.checks.find((c) => c.id === "quality.lint.clean"),
    ).toMatchObject({
      base: "green",
      head: "red",
      outcome: "fail",
    });
  }, 60_000);

  it("runs the base's scripts and marks a scripts edit needs-human", async () => {
    const r = await repo();
    await r.write("src/feature.js", "// BAD\n");
    await r.write(
      "package.json",
      JSON.stringify(
        {
          name: "demo",
          private: true,
          scripts: { lint: 'node -e ""', test: 'node -e ""' },
        },
        null,
        2,
      ),
    );
    await r.commit("silence lint");
    const result = await judge(r.dir);
    expect(result.verdict).toBe("needs-human");
    expect(result.protected.map((p) => p.reason)).toContain("scripts");
    // The no-op lint script was ignored: base's lint still caught BAD.
    expect(result.checks.find((c) => c.id === "quality.lint.clean")?.head).toBe(
      "red",
    );
  }, 60_000);

  it("marks a change to .factory/waivers.yml needs-human", async () => {
    const r = await repo();
    await r.write(".factory/waivers.yml", "[]\n");
    await r.commit("waive");
    const result = await judge(r.dir);
    expect(result.verdict).toBe("needs-human");
    expect(result.protected[0]).toMatchObject({
      reason: "factory-state",
      path: ".factory/waivers.yml",
    });
  }, 60_000);

  it("reports a check red on base and change as pre-existing, not a failure", async () => {
    const r = await repo();
    await r.write("src/legacy.js", "// BAD\n");
    await r.commit("legacy problem");
    await simpleGit(r.dir).raw(["branch", "-f", "base"]);
    await r.write("src/feature.js", "module.exports = 3;\n");
    await r.commit("feature");
    const result = await judge(r.dir);
    expect(result.verdict).toBe("pass");
    expect(
      result.checks.find((c) => c.id === "quality.lint.clean")?.outcome,
    ).toBe("pre-existing");
  }, 60_000);

  it("fails closed when a check can't run", async () => {
    const r = await repo();
    await r.write("src/feature.js", "module.exports = 2;\n");
    await r.commit("feature");
    const result = await runTier1({
      repoPath: r.dir,
      base: "base",
      install: false,
      checks: ["quality.typecheck.clean"], // no typescript here: n/a
    });
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain("nothing was verified");
  }, 60_000);
});
