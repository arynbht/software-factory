// Git worktree isolation for the build pipeline. The implementer agent runs in a
// throwaway linked worktree on a fresh branch, so the user's checkout and working
// tree are never touched — the only thing that reaches them is a PR. Thin wrappers
// over simple-git (already a dep, used by fix-pr.ts); the build pipeline injects a
// fake of these in tests so it needs no real git.
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";

export interface Worktree {
  /** Absolute path of the linked worktree. */
  path: string;
  branch: string;
  /** The branch the worktree was created from (the PR base). */
  base: string;
}

/** The current branch of the main checkout (the PR base). */
export async function currentBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  if (branch === "HEAD" || branch === "") {
    throw new Error("HEAD is detached; check out a branch before building");
  }
  return branch;
}

/** Create a linked worktree on a new `branch` off the current HEAD. */
export async function createWorktree(
  repoPath: string,
  branch: string,
): Promise<Worktree> {
  const git = simpleGit(repoPath);
  if (!(await git.checkIsRepo())) {
    throw new Error(`${repoPath} is not a git repository`);
  }
  const base = await currentBranch(repoPath);
  const path = join(
    tmpdir(),
    `factory-build-${randomBytes(6).toString("hex")}`,
  );
  await git.raw(["worktree", "add", "-b", branch, path, base]);
  return { path, branch, base };
}

/**
 * Git for the worktree with hooks off. The agent can edit any file in it,
 * including an in-repo hooks dir (`.husky`), and those hooks would run with
 * the factory's full environment on commit or push.
 */
async function hooklessGit(worktreePath: string) {
  const noHooks = join(tmpdir(), "factory-no-hooks");
  await mkdir(noHooks, { recursive: true });
  // simple-git guards core.hooksPath against injection; this points it at an
  // empty directory, the opposite of injection.
  return simpleGit(worktreePath, {
    config: [`core.hooksPath=${noHooks}`],
    unsafe: { allowUnsafeHooksPath: true },
  });
}

/** Stage everything and commit; returns false when there was nothing to commit. */
export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<boolean> {
  const git = await hooklessGit(worktreePath);
  await git.add(["-A"]);
  const staged = (await git.raw(["diff", "--cached", "--name-only"])).trim();
  if (staged === "") return false;
  await git.commit(message, ["--no-verify"]);
  return true;
}

/** Push the branch to the remote, setting upstream. */
export async function pushBranch(
  worktreePath: string,
  remote: string,
  branch: string,
): Promise<void> {
  await (
    await hooklessGit(worktreePath)
  ).push([remote, branch, "--set-upstream", "--no-verify"]);
}

/** Remove the linked worktree (best-effort) and delete its directory. */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  await simpleGit(repoPath)
    .raw(["worktree", "remove", "--force", worktreePath])
    .catch(() => undefined);
  await rm(worktreePath, { recursive: true, force: true }).catch(
    () => undefined,
  );
}
