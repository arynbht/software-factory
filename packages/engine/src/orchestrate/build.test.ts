import { describe, expect, it, vi } from "vitest";

import type { AuditContext } from "../context.js";
import { runBuild, type GitOps } from "./build.js";
import type { BuildPlan, VerifyResult } from "./types.js";

const ctx = { repoPath: "/repo" } as AuditContext;
const plan: BuildPlan = {
  request: "add a feature",
  summary: "do the thing",
  affectedSystems: [],
  tasks: [{ title: "t", detail: "d", paths: [] }],
  acceptanceCriteria: [],
  risks: [],
};
const date = "2026-11-03";

// A write-agent runner always returns a valid claude `--output-format json` blob.
const okRunner = () =>
  Promise.resolve(JSON.stringify({ result: "did it", usage: {} }));

const pass: VerifyResult = {
  passed: true,
  checks: [{ name: "test", passed: true, ran: true, output: "" }],
};
const fail: VerifyResult = {
  passed: false,
  checks: [{ name: "test", passed: false, ran: true, output: "boom" }],
};

function fakeGit(): GitOps & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    createWorktree: vi.fn((_r: string, branch: string) =>
      Promise.resolve({ path: "/wt", branch, base: "main" }),
    ),
    commitAll: vi.fn(() => Promise.resolve(true)),
    pushBranch: vi.fn(() => Promise.resolve()),
    removeWorktree: vi.fn((_r: string, p: string) => {
      removed.push(p);
      return Promise.resolve();
    }),
  } as GitOps & { removed: string[] };
}

const openPr = () =>
  Promise.resolve({ number: 7, url: "http://pr/7", reused: false });

describe("runBuild", () => {
  it("implements, verifies, commits, pushes, opens a PR, and cleans up", async () => {
    const git = fakeGit();
    const writeAgent = vi.fn(okRunner);
    const result = await runBuild(ctx, plan, {
      date,
      git,
      writeAgent,
      verify: () => Promise.resolve(pass),
      openPr,
    });

    expect(result.iterations).toBe(1);
    expect(writeAgent).toHaveBeenCalledTimes(1); // implement only
    expect(result.pushed).toBe(true);
    expect(result.pr?.number).toBe(7);
    expect(result.branch).toContain("factory/build-2026-11-03-");
    expect(git.removed).toEqual(["/wt"]); // worktree cleaned up
  });

  it("runs the bounded fix-loop when verify fails then passes", async () => {
    const git = fakeGit();
    const verify = vi
      .fn<() => Promise<VerifyResult>>()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(pass);
    const writeAgent = vi.fn(okRunner);
    const result = await runBuild(ctx, plan, {
      date,
      git,
      writeAgent,
      verify,
      openPr,
    });

    expect(result.iterations).toBe(2);
    expect(writeAgent).toHaveBeenCalledTimes(2); // implement + 1 fix
    expect(result.pushed).toBe(true);
  });

  it("does not open a PR when the build never passes its checks", async () => {
    const git = fakeGit();
    const writeAgent = vi.fn(okRunner);
    const result = await runBuild(ctx, plan, {
      date,
      git,
      writeAgent,
      verify: () => Promise.resolve(fail),
      openPr,
      maxIterations: 3,
    });

    expect(result.iterations).toBe(3); // implement + 2 fixes
    expect(writeAgent).toHaveBeenCalledTimes(3);
    expect(result.verify.passed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.pr).toBeNull();
    expect(git.pushBranch).not.toHaveBeenCalled();
    expect(git.removed).toEqual(["/wt"]); // still cleaned up
  });

  it("stops at a local branch when push is disabled", async () => {
    const git = fakeGit();
    const result = await runBuild(ctx, plan, {
      date,
      git,
      writeAgent: okRunner,
      verify: () => Promise.resolve(pass),
      push: false,
      openPr,
    });
    expect(result.pushed).toBe(false);
    expect(result.pr).toBeNull();
    expect(git.pushBranch).not.toHaveBeenCalled();
  });

  it("removes the worktree even if the implementer throws", async () => {
    const git = fakeGit();
    await expect(
      runBuild(ctx, plan, {
        date,
        git,
        writeAgent: () => Promise.reject(new Error("agent died")),
        verify: () => Promise.resolve(pass),
        openPr,
      }),
    ).rejects.toThrow(/agent died/);
    expect(git.removed).toEqual(["/wt"]);
  });
});
