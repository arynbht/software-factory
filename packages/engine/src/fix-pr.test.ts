import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "./context.js";
import { openFixPr, FixPrError } from "./fix-pr.js";
import type { Change } from "./generators/types.js";
import type { OpenPrParams, PrResult } from "./github/pr.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

// A git repo on branch `main` with a bare `origin` remote and a clean tree.
async function repoWithRemote(): Promise<string> {
  const { simpleGit } = await import("simple-git");
  const bare = await tmp("factory-remote-");
  await simpleGit(bare).init(true);

  const work = await tmp("factory-work-");
  const git = simpleGit(work);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  await git.addConfig("commit.gpgsign", "false");
  await git.addRemote("origin", bare);
  await writeFile(join(work, "seed.txt"), "seed\n");
  await git.add(["seed.txt"]);
  await git.commit("initial");
  await git.branch(["-M", "main"]);
  return work;
}

const fakePr =
  (sink: OpenPrParams[], reused = false) =>
  async (params: OpenPrParams): Promise<PrResult> => {
    sink.push(params);
    return { number: 11, url: "https://github.com/o/r/pull/11", reused };
  };

const fileChange = (controlId: string, path: string): Change => ({
  type: "file",
  controlId,
  path,
  contents: `content for ${controlId}\n`,
  op: "create",
});

describe("openFixPr", () => {
  it("branches, commits per control, pushes, opens a PR, returns to base", async () => {
    const work = await repoWithRemote();
    const ctx = buildContext(work, { github: { owner: "o", repo: "r" } });
    const calls: OpenPrParams[] = [];

    const result = await openFixPr(
      ctx,
      [
        fileChange("doc.readme", "README.md"),
        fileChange("repo.license", "LICENSE"),
      ],
      { gate: "scaffold", date: "2026-11-01", openPr: fakePr(calls) },
    );

    expect(result.pushed).toBe(true);
    expect(result.branch).toBe("factory/2026-11-01-scaffold");
    expect(result.base).toBe("main");
    expect(result.commits).toHaveLength(2);
    expect(result.pr?.number).toBe(11);
    expect(calls[0]).toMatchObject({
      head: "factory/2026-11-01-scaffold",
      base: "main",
      title: "factory: 2 fixes for scaffold",
    });

    const { simpleGit } = await import("simple-git");
    const git = simpleGit(work);
    // We end back on the base branch.
    expect((await git.revparse(["--abbrev-ref", "HEAD"])).trim()).toBe("main");
    // The factory branch exists and carries the commits.
    const log = await git.log(["factory/2026-11-01-scaffold"]);
    const messages = log.all.map((c) => c.message);
    expect(messages.some((m) => m.includes("doc.readme"))).toBe(true);
    expect(messages.some((m) => m.includes("repo.license"))).toBe(true);
    expect(messages.some((m) => m.includes("managed-file registry"))).toBe(
      true,
    );
  });

  it("opens no PR and leaves no branch when nothing changed", async () => {
    const work = await repoWithRemote();
    const ctx = buildContext(work, { github: { owner: "o", repo: "r" } });
    const calls: OpenPrParams[] = [];

    const result = await openFixPr(ctx, [], {
      gate: "scaffold",
      date: "2026-11-01",
      openPr: fakePr(calls),
    });

    expect(result.pushed).toBe(false);
    expect(result.pr).toBeNull();
    expect(calls).toHaveLength(0);

    const { simpleGit } = await import("simple-git");
    const branches = await simpleGit(work).branchLocal();
    expect(branches.all).not.toContain("factory/2026-11-01-scaffold");
    expect(branches.current).toBe("main");
  });

  it("refuses to run on a dirty working tree", async () => {
    const work = await repoWithRemote();
    await writeFile(join(work, "seed.txt"), "dirty\n");
    const ctx = buildContext(work, { github: { owner: "o", repo: "r" } });

    await expect(
      openFixPr(ctx, [fileChange("doc.readme", "README.md")], {
        gate: "scaffold",
        date: "2026-11-01",
        openPr: fakePr([]),
      }),
    ).rejects.toBeInstanceOf(FixPrError);
  });

  it("reuses the branch and updates the PR on a second run", async () => {
    const work = await repoWithRemote();
    const ctx = buildContext(work, { github: { owner: "o", repo: "r" } });

    await openFixPr(ctx, [fileChange("doc.readme", "README.md")], {
      gate: "scaffold",
      date: "2026-11-01",
      openPr: fakePr([]),
    });

    // Second run with an extra control reuses the existing branch.
    const calls: OpenPrParams[] = [];
    const result = await openFixPr(
      ctx,
      [
        fileChange("doc.readme", "README.md"),
        fileChange("repo.license", "LICENSE"),
      ],
      { gate: "scaffold", date: "2026-11-01", openPr: fakePr(calls, true) },
    );

    expect(result.pr?.reused).toBe(true);
    // README was already committed and unchanged; only LICENSE is new this run.
    expect(result.commits.map((c) => c.controlId)).toContain("repo.license");
  });

  it("does not push or touch a PR when a reused branch has no new changes", async () => {
    const work = await repoWithRemote();
    const ctx = buildContext(work, { github: { owner: "o", repo: "r" } });
    const change = [fileChange("doc.readme", "README.md")];

    await openFixPr(ctx, change, {
      gate: "scaffold",
      date: "2026-11-01",
      openPr: fakePr([]),
    });

    // Second run with the identical change: branch exists, nothing new to commit.
    const calls: OpenPrParams[] = [];
    const result = await openFixPr(ctx, change, {
      gate: "scaffold",
      date: "2026-11-01",
      openPr: fakePr(calls, true),
    });

    expect(result.commits).toHaveLength(0);
    expect(result.pushed).toBe(false);
    expect(result.pr).toBeNull();
    expect(calls).toHaveLength(0);

    const { simpleGit } = await import("simple-git");
    const git = simpleGit(work);
    expect((await git.revparse(["--abbrev-ref", "HEAD"])).trim()).toBe("main");
    // The reused branch is left in place (an open PR for it must not be disturbed).
    expect((await git.branchLocal()).all).toContain(
      "factory/2026-11-01-scaffold",
    );
  });
});
