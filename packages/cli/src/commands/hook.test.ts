import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { doctorChecks } from "./doctor.js";
import { guardReason, sessionStartText } from "./hook.js";

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

describe("factory hook session-start", () => {
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

  it("passes a set-up repo whose skills match the lock", async () => {
    const { repo } = await factoryRepo();
    const checks = await doctorChecks(repo, {
      token: "t",
      claude: async () => "2.1.0 (Claude Code)",
    });
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.find((c) => c.name === "claude")?.detail).toBe(
      "2.1.0 (Claude Code)",
    );
  });
});
