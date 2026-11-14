// Tier 1 end to end on a real git repo: no mocks for git, the clone, or the
// checks. The repo's "lint" fails when any source file contains `BAD`.
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";

import { runTier1, sweepStaleClones } from "./tier1.js";

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

  it("doesn't ask again about a protected change a person allowed", async () => {
    const r = await repo();
    await r.write(".factory/waivers.yml", "[]\n");
    await r.commit("waive");
    const allowed = await runTier1({
      repoPath: r.dir,
      base: "base",
      install: false,
      allowed: (f) => f.path === ".factory/waivers.yml",
    });
    // Still listed, so the PR says a person approved it, but the checks decide.
    expect(allowed.protected[0]?.path).toBe(".factory/waivers.yml");
    expect(allowed.verdict).toBe("pass");
    const other = await runTier1({
      repoPath: r.dir,
      base: "base",
      install: false,
      allowed: (f) => f.path === "package.json",
    });
    expect(other.verdict).toBe("needs-human");
  }, 60_000);

  it("runs an allowed change to an existing test as changed, not as it was at base", async () => {
    const r = await repo();
    await r.write(
      "package.json",
      JSON.stringify(
        {
          name: "demo",
          private: true,
          scripts: { lint: "node lint.cjs", test: "node test/app.test.js" },
        },
        null,
        2,
      ),
    );
    const check = (n: number) =>
      `if (require("../src/app.js") !== ${n}) process.exit(1);\n`;
    await r.write("test/app.test.js", check(1));
    await r.commit("a test of app.js");
    await simpleGit(r.dir).raw(["branch", "-f", "base"]);
    // The card changes the behaviour, so the test that pinned it changes too.
    await r.write("src/app.js", "module.exports = 2;\n");
    await r.write("test/app.test.js", check(2));
    await r.commit("app is 2 now");
    const run = (allowed: boolean) =>
      runTier1({
        repoPath: r.dir,
        base: "base",
        install: false,
        checks: ["quality.tests.pass"],
        allowed: () => allowed,
      });
    expect((await run(true)).verdict).toBe("pass");
    // Unanswered, the base's test still judges it (and a person is asked).
    const unanswered = await run(false);
    expect(unanswered.verdict).toBe("needs-human");
    expect(
      unanswered.checks.find((c) => c.id === "quality.tests.pass")?.head,
    ).toBe("red");
  }, 60_000);

  it("switches to the change even when the base's checks wrote into the clone", async () => {
    const r = await repo();
    // Like a build that writes over a committed bundle, plus a file git doesn't track.
    await r.write(
      "package.json",
      JSON.stringify(
        {
          name: "demo",
          private: true,
          scripts: {
            lint: "node lint.cjs",
            test: `node -e "require('fs').writeFileSync('dist/out.js','built');require('fs').writeFileSync('dist/extra.js','built')"`,
          },
        },
        null,
        2,
      ),
    );
    await r.write("dist/out.js", "committed\n");
    await r.commit("a build that writes into dist");
    await simpleGit(r.dir).raw(["branch", "-f", "base"]);
    await r.write("dist/extra.js", "committed at head\n");
    await r.write("src/feature.js", "module.exports = 2;\n");
    await r.commit("feature");
    const result = await judge(r.dir);
    expect(result.verdict).toBe("pass");
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

  it("disables the target repo's hooks inside the clone", async () => {
    const r = await repo();
    await r.write("src/feature.js", "module.exports = 2;\n");
    await r.commit("feature");
    const result = await runTier1({
      repoPath: r.dir,
      base: "base",
      install: false,
      keep: true,
    });
    made.push(result.workDir);
    const hooksPath = await simpleGit(result.workDir).getConfig(
      "core.hooksPath",
    );
    expect(hooksPath.value).toContain("factory-no-hooks");
  }, 60_000);

  it("won't pass a non-Node repo on checks that are red at base too", async () => {
    const r = await repo();
    await r.write("pyproject.toml", "[project]\nname = 'demo'\n");
    await r.write("app.py", "import os\n");
    await r.commit("python");
    await simpleGit(r.dir).raw(["branch", "-f", "base"]);
    await r.write("other.py", "x = 1\n");
    await r.commit("feature");
    const result = await runTier1({
      repoPath: r.dir,
      base: "base",
      install: false,
      checks: ["quality.tests.pass"],
    });
    expect(result.verdict).toBe("fail");
    expect(result.notes.join(" ")).toContain(
      "python dependencies aren't installed by the judge yet",
    );
  }, 60_000);

  it("runs the repo's scripts without the caller's secrets", async () => {
    const r = await repo();
    // A test script that fails if it can see a token from the caller's shell.
    await r.write(
      "package.json",
      JSON.stringify(
        {
          name: "demo",
          private: true,
          scripts: {
            lint: "node lint.cjs",
            test: 'node -e "process.exit(process.env.FACTORY_TEST_SECRET ? 1 : 0)"',
          },
        },
        null,
        2,
      ),
    );
    await r.commit("leak probe");
    await simpleGit(r.dir).raw(["branch", "-f", "base"]);
    await r.write("src/feature.js", "module.exports = 2;\n");
    await r.commit("feature");
    process.env.FACTORY_TEST_SECRET = "ghp_should_not_leak";
    try {
      const result = await judge(r.dir);
      expect(
        result.checks.find((c) => c.id === "quality.tests.pass")?.head,
      ).toBe("green");
      // Passing it on purpose is allowed, and then the probe sees it.
      const opted = await runTier1({
        repoPath: r.dir,
        base: "base",
        install: false,
        env: ["FACTORY_TEST_SECRET"],
      });
      expect(
        opted.checks.find((c) => c.id === "quality.tests.pass")?.head,
      ).toBe("red");
    } finally {
      delete process.env.FACTORY_TEST_SECRET;
    }
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

describe("sweepStaleClones", () => {
  it("removes judge clones older than a day and keeps fresh ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sweep-"));
    made.push(root);
    await mkdir(join(root, "factory-judge-old"));
    await mkdir(join(root, "factory-judge-new"));
    await mkdir(join(root, "something-else"));
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60_000);
    await utimes(join(root, "factory-judge-old"), twoDaysAgo, twoDaysAgo);
    await utimes(join(root, "something-else"), twoDaysAgo, twoDaysAgo);

    await sweepStaleClones(root);
    expect((await readdir(root)).sort()).toEqual([
      "factory-judge-new",
      "something-else",
    ]);
  });
});
