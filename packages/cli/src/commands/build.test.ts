import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBuildCommand } from "./build.js";
import type { BuildPlan, BuildResult } from "@arynbht/factory-engine";

const plan: BuildPlan = {
  request: "add a flag",
  summary: "add a --version flag",
  affectedSystems: ["CLI"],
  tasks: [{ title: "add flag", detail: "wire it", paths: ["src/cli.ts"] }],
  acceptanceCriteria: ["--version prints the version"],
  risks: [],
};

function result(passed: boolean): BuildResult {
  return {
    branch: "factory/build-2026-11-03-add-a-flag",
    base: "main",
    worktree: "/wt",
    plan,
    verify: {
      passed,
      checks: [{ name: "test", passed, ran: true, output: "" }],
    },
    iterations: 1,
    pushed: passed,
    pr: passed ? { number: 9, url: "http://pr/9", reused: false } : null,
    notes: "done",
  };
}

const out: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    });
});
afterEach(() => {
  spy.mockRestore();
  out.length = 0;
});

describe("runBuildCommand", () => {
  it("plans only (no build) without --yes", async () => {
    const build = vi.fn();
    const code = await runBuildCommand(
      "add a flag",
      ".",
      {},
      { token: null, plan: () => Promise.resolve(plan), build },
    );
    expect(code).toBe(0);
    expect(build).not.toHaveBeenCalled();
    const text = out.join("");
    expect(text).toContain("add a --version flag");
    expect(text).toContain("Re-run with --yes");
  });

  it("builds with --yes and returns 0 when checks pass", async () => {
    const build = vi.fn(() => Promise.resolve(result(true)));
    const code = await runBuildCommand(
      "add a flag",
      ".",
      { yes: true },
      {
        token: null,
        today: "2026-11-03",
        plan: () => Promise.resolve(plan),
        build,
      },
    );
    expect(code).toBe(0);
    expect(build).toHaveBeenCalledOnce();
    expect(out.join("")).toContain("Opened PR #9");
  });

  it("returns 1 when the build does not pass its checks", async () => {
    const build = vi.fn(() => Promise.resolve(result(false)));
    const code = await runBuildCommand(
      "add a flag",
      ".",
      { yes: true },
      { token: null, plan: () => Promise.resolve(plan), build },
    );
    expect(code).toBe(1);
    expect(out.join("")).toContain("Build did not pass");
  });
});
