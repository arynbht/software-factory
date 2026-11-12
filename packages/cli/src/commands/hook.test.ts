import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { doctorChecks } from "./doctor.js";
import {
  guardReason,
  guardSelfTest,
  parseShell,
  sessionStartText,
} from "./hook.js";
import { SETTINGS_JSON } from "./init-files.js";

const made: string[] = [];
const savedConfig = process.env.FACTORY_CONFIG_DIR;
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

beforeEach(async () => {
  process.env.FACTORY_CONFIG_DIR = await tmp("factory-config-");
});
afterEach(async () => {
  if (savedConfig === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = savedConfig;
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

/** A repo on main with a factory profile, and a linked worktree on a task branch. */
async function factoryRepo(): Promise<{ repo: string; worktree: string }> {
  const repo = await tmp("factory-hook-");
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  await mkdir(join(repo, ".factory"));
  await writeFile(join(repo, ".factory", "profile.yml"), "version: 1\n");
  await writeFile(join(repo, "README.md"), "# demo\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "base", "--no-verify");
  const worktree = join(repo, ".worktrees", "T-0001");
  git(repo, "worktree", "add", "-b", "fix/t-0001", worktree, "main");
  return { repo, worktree };
}

// How a path is written in a shell command (Git Bash takes C:/x too).
const posix = (path: string) => path.split("\\").join("/");

const edit = (cwd: string, file_path: string) =>
  guardReason({ cwd, tool_input: { file_path } });

describe("factory hook guard", () => {
  it("refuses edits in the primary checkout on main, new files included", async () => {
    const { repo } = await factoryRepo();
    expect(await edit(repo, "README.md")).toMatch(
      /primary checkout on main.*\/factory/,
    );
    expect(await edit(repo, join(repo, "src", "new", "file.ts"))).toMatch(
      /primary checkout on main/,
    );
  });

  it("allows edits in a task's worktree, but never to .factory/**", async () => {
    const { repo, worktree } = await factoryRepo();
    // The session's cwd is the primary checkout; the file is in the worktree.
    expect(await edit(repo, join(worktree, "README.md"))).toBeNull();
    expect(
      await edit(worktree, join(worktree, ".factory", "waivers.yml")),
    ).toMatch(/\.factory\/waivers\.yml is the factory's state/);
    expect(await edit(repo, ".factory/tasks/T-0001/ledger.md")).toMatch(
      /factory's state/,
    );
  });

  it("still guards .factory/** when the checkout is reached through a symlink", async () => {
    const { repo } = await factoryRepo();
    git(repo, "checkout", "-b", "by-hand");
    const link = join(await tmp("factory-link-"), "repo");
    // A junction on Windows (no admin rights needed), a symlink elsewhere.
    await symlink(repo, link, "junction");
    expect(await edit(link, join(link, ".factory", "waivers.yml"))).toMatch(
      /factory's state/,
    );
    expect(await edit(link, join(link, "README.md"))).toBeNull();
  });

  it("allows edits on another branch, and in repos without a factory profile", async () => {
    const { repo } = await factoryRepo();
    git(repo, "checkout", "-b", "by-hand");
    expect(await edit(repo, "README.md")).toBeNull();

    const plain = await tmp("plain-");
    git(plain, "init", "-b", "main");
    expect(await edit(plain, "README.md")).toBeNull();
    expect(await guardReason({ cwd: plain, tool_input: {} })).toBeNull();
  });
});

describe("parseShell", () => {
  it("finds commands, words and redirect targets the way a shell would", () => {
    expect(
      parseShell(
        `FOO=1 sed -i 's/a > b/c/' "my file.txt" && echo hi>out.txt 2>&1 | tee -a log.txt; cat <in.txt >>"app.log" 2>/dev/null`,
      ),
    ).toEqual([
      {
        words: ["FOO=1", "sed", "-i", "s/a > b/c/", "my file.txt"],
        redirects: [],
        then: "&&",
        depth: 0,
      },
      { words: ["echo", "hi"], redirects: ["out.txt"], then: "|", depth: 0 },
      { words: ["tee", "-a", "log.txt"], redirects: [], then: ";", depth: 0 },
      {
        words: ["cat"],
        redirects: ["app.log", "/dev/null"],
        then: "",
        depth: 0,
      },
    ]);
  });

  it("knows which commands run in a subshell", () => {
    expect(
      parseShell("(cd /tmp && ls); echo $(pwd) `date`").map((c) => [
        c.words[0],
        c.depth,
      ]),
    ).toEqual([
      ["cd", 1],
      ["ls", 1],
      ["echo", 0],
      ["pwd", 1],
      ["date", 1],
    ]);
  });

  it("treats heredoc bodies, comments and here-strings as data", () => {
    expect(
      parseShell(
        "cat > notes.md <<'EOF'\nrm -rf .factory\nEOF\n# rm x\ngrep x <<< 'rm y' # rm z\nls",
      ).map(({ words, redirects }) => ({ words, redirects })),
    ).toEqual([
      { words: ["cat"], redirects: ["notes.md"] },
      { words: ["grep", "x"], redirects: [] },
      { words: ["ls"], redirects: [] },
    ]);
  });
});

describe("factory hook guard, for Bash", () => {
  const bash = (cwd: string, command: string) =>
    guardReason({ cwd, tool_input: { command } });

  it("refuses writes through Bash to anything the edit guard protects", async () => {
    const { repo, worktree } = await factoryRepo();
    for (const command of [
      "echo '[]' > .factory/waivers.yml",
      "cd .factory && sed -i 's/x/y/' waivers.yml",
      `cp /tmp/x ${posix(join(worktree, ".factory", "evidence.yml"))}`,
      "rm -rf .factory/*",
      "printf x | tee README.md",
      "mv README.md docs.md",
      // `-t` names the destination: the source is only read.
      "cp -t .factory /tmp/x",
      "install --target-directory=.factory /tmp/x",
      "echo x >& .factory/waivers.yml",
      "sudo -u root rm .factory/profile.yml",
      "env -i FOO=1 rm .factory/profile.yml",
      "echo x \\\n  > .factory/waivers.yml",
    ])
      expect(await bash(repo, command), command).toMatch(
        /this command (writes|removes) .*(factory's state|primary checkout on main)/,
      );
  });

  it("refuses wiping the checkout, whichever way it's spelled", async () => {
    const { repo, worktree } = await factoryRepo();
    for (const command of ["rm -rf *", "rm -rf .", `rm -rf "$PWD"`])
      expect(await bash(repo, command), command).toMatch(
        /this command (writes|removes)/,
      );
    // In a worktree: `.` holds .factory/**; `*` doesn't match dotfiles.
    expect(await bash(worktree, "rm -rf .")).toMatch(/\.factory\/\*\* with it/);
    expect(await bash(worktree, "cd .. && rm -rf T-0001")).toMatch(
      /\.factory\/\*\* with it/,
    );
    expect(await bash(worktree, "rm -rf *")).toBeNull();
  });

  it("doesn't let a cd that may not have moved the shell hide a write", async () => {
    const { repo, worktree } = await factoryRepo();
    const elsewhere = posix(await tmp("elsewhere-"));
    for (const command of [
      `(cd ${elsewhere} && ls); rm -rf .factory`,
      `cd /nonexistent; rm -rf .factory`,
      `cd ${elsewhere} || true && rm -rf .factory`,
      `cd ${elsewhere} | rm -rf .factory`,
    ])
      expect(await bash(worktree, command), command).toMatch(
        /\.factory\/\*\* with it/,
      );
    // A cd that certainly moved does count: scratch work elsewhere is fine.
    expect(await bash(repo, `cd ${elsewhere} && echo x > out.txt`)).toBeNull();
  });

  it("only sees sed -i and perl -i as in-place", async () => {
    const { repo } = await factoryRepo();
    expect(await bash(repo, "sed -Ei 's/a/b/' README.md")).toMatch(
      /writes README\.md/,
    );
    expect(await bash(repo, "perl -pi -e 's/a/b/' README.md")).toMatch(
      /writes README\.md/,
    );
    expect(await bash(repo, "perl -Mstrict -e 'print 1' README.md")).toBeNull();
  });

  it("checks command lines run through sh -c and eval", async () => {
    const { repo } = await factoryRepo();
    for (const command of [
      `bash -lc "echo x > .factory/waivers.yml"`,
      `sh -c 'git push --force'`,
      "eval rm .factory/profile.yml",
    ])
      expect(await bash(repo, command), command).not.toBeNull();
    expect(await bash(repo, `bash -c "git status"`)).toBeNull();
  });

  it("refuses Bash writes to .factory/** from a task's worktree too", async () => {
    const { worktree } = await factoryRepo();
    for (const command of [
      "rm -rf .factory",
      "rm -rf .factory/*",
      "echo x > .factory/waivers.yml",
      "echo x > ${PWD}/.factory/waivers.yml",
    ])
      expect(await bash(worktree, command), command).toMatch(
        /this command (writes|removes) .*factory's state/,
      );
  });

  it("lets reads, scratch writes and a task's worktree through", async () => {
    const { repo, worktree } = await factoryRepo();
    for (const command of [
      "cat .factory/profile.yml && git status 2>&1",
      "npm test > /dev/null",
      `echo x > "${join(tmpdir(), "scratch.txt")}"`,
      "cat > notes.md <<'EOF'\nrm -rf .factory\nEOF",
      "sed 's/x/y/' README.md",
    ])
      expect(await bash(worktree, command), command).toBeNull();
    expect(
      await bash(repo, `echo x > ${posix(join(worktree, "README.md"))}`),
    ).toBeNull();
  });

  it("refuses git commands that destroy work, in a factory repo only", async () => {
    const { repo, worktree } = await factoryRepo();
    for (const command of [
      "git push --force origin main",
      "git push -uf origin fix/t-0001",
      "git push origin +main",
      "git push origin --delete fix/t-0001",
      "git -C . reset --hard HEAD~1",
      "git clean -fdx",
      "git branch -D old",
    ])
      expect(await bash(worktree, command), command).toMatch(
        /run it yourself in a terminal/,
      );
    for (const command of [
      "git push -u origin fix/t-0001",
      "git push --force-if-includes-not-a-flag",
      "git clean -n",
      "git reset --soft HEAD~1",
      "git branch -d merged",
    ])
      expect(await bash(worktree, command), command).toBeNull();
    const plain = await tmp("plain-");
    git(plain, "init", "-b", "main");
    expect(await bash(plain, "git push --force")).toBeNull();
    expect(await bash(repo, "git status")).toBeNull();
  });
});

describe("factory hook session-start", () => {
  it("says on its first line whether the guard is on", async () => {
    const { repo } = await factoryRepo();
    expect((await sessionStartText(repo)).split("\n")[0]).toMatch(
      /^factory guard: OFF\. no \.claude\/settings\.json/,
    );
    await mkdir(join(repo, ".claude"));
    await writeFile(join(repo, ".claude", "settings.json"), SETTINGS_JSON);
    expect((await sessionStartText(repo)).split("\n")[0]).toBe(
      "factory guard: on.",
    );
    // An earlier init's hook: no Bash, and it fails open.
    await writeFile(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit|Write|MultiEdit|NotebookEdit",
              hooks: [{ type: "command", command: "factory hook guard" }],
            },
          ],
        },
      }),
    );
    expect((await guardSelfTest(repo)).detail).toMatch(/older factory/);
  });

  it("states the contract and points at a missing AGENTS.md", async () => {
    const { repo } = await factoryRepo();
    const text = await sessionStartText(repo);
    expect(text).toContain("Start every task with /factory");
    expect(text).toContain(
      "Beats: sync → intake → route → isolate → build → prove → judge → ship → close",
    );
    expect(text).toContain("AGENTS.md is missing");
  });
});

describe("factory doctor", () => {
  it("fails without a profile or the claude CLI, and warns without GitHub", async () => {
    const dir = await tmp("factory-doctor-");
    git(dir, "init", "-b", "main");
    const checks = await doctorChecks(dir, {
      token: null,
      claude: () => Promise.reject(new Error("not found")),
    });
    const by = Object.fromEntries(checks.map((c) => [c.name, c.status]));
    expect(by).toEqual({
      git: "ok",
      profile: "fail",
      claude: "fail",
      github: "warn",
      skills: "warn",
    });
  });

  it("passes a set-up repo whose hooks are live and skills match the lock", async () => {
    const { repo } = await factoryRepo();
    await mkdir(join(repo, ".claude"));
    await writeFile(join(repo, ".claude", "settings.json"), SETTINGS_JSON);
    const checks = await doctorChecks(repo, {
      token: "t",
      claude: async () => "2.1.0 (Claude Code)",
      guardInShell: async () => true,
    });
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.find((c) => c.name === "claude")?.detail).toBe(
      "2.1.0 (Claude Code)",
    );
  });

  it("fails while the guard can't run: not installed, or factory off PATH", async () => {
    const { repo } = await factoryRepo();
    const hooks = async (guardInShell: () => Promise<boolean>) =>
      (
        await doctorChecks(repo, {
          token: "t",
          claude: async () => "2.1.0",
          guardInShell,
        })
      ).find((c) => c.name === "hooks");
    expect(await hooks(async () => true)).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/no \.claude\/settings\.json/),
    });
    await mkdir(join(repo, ".claude"));
    await writeFile(join(repo, ".claude", "settings.json"), SETTINGS_JSON);
    expect(await hooks(async () => false)).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/on PATH/),
    });
  });
});
