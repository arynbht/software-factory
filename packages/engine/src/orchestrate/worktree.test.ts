// The build pipeline's git on a real repo: commits and pushes never run the
// repo's hooks, which the write-agent could have edited.
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";

import { commitAll, createWorktree, removeWorktree } from "./worktree.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

describe("worktree git", { timeout: 30_000 }, () => {
  it("commits without running an in-repo hook the agent could edit", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wt-hooks-"));
    made.push(repo);
    const git = simpleGit(repo);
    await git.init(["-b", "main"]);
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await writeFile(join(repo, "a.txt"), "a\n");
    await git.add(["-A"]);
    await git.commit("base", ["--no-verify"]);
    // husky-style: hooks live in the repo.
    await simpleGit(repo, { unsafe: { allowUnsafeHooksPath: true } }).addConfig(
      "core.hooksPath",
      ".husky",
    );

    const wt = await createWorktree(repo, "factory/test");
    made.push(wt.path);
    const marker = join(wt.path, "hook-ran");
    await mkdir(join(wt.path, ".husky"), { recursive: true });
    for (const hook of ["pre-commit", "commit-msg", "post-commit"]) {
      const path = join(wt.path, ".husky", hook);
      const target = marker.split("\\").join("/");
      await writeFile(path, `#!/bin/sh\necho ${hook} > "${target}"\n`);
      await chmod(path, 0o755);
    }
    await writeFile(join(wt.path, "a.txt"), "changed\n");
    expect(await commitAll(wt.path, "factory: change")).toBe(true);
    await expect(access(marker)).rejects.toThrow();
    await removeWorktree(repo, wt.path);
  });
});
