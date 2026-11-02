import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { runTool, splitArgs, ToolNotFoundError } from "./exec.js";

const isWindows = process.platform === "win32";

describe("runTool", () => {
  it("runs a present binary and captures exit 0", async () => {
    const result = await runTool("node", ["--version"], tmpdir());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+\./);
  });

  it("returns the real exit code on failure (not a throw)", async () => {
    const result = await runTool("node", ["-e", "process.exit(3)"], tmpdir());
    expect(result.exitCode).toBe(3);
  });

  it("throws ToolNotFoundError for a missing binary", async () => {
    await expect(
      runTool("definitely-not-a-real-binary-xyz", ["--version"], tmpdir()),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  // npm ships as npm.cmd on Windows; execFile can't launch it directly, so this
  // asserts the PATHEXT resolution + shell path actually works there.
  it.runIf(isWindows)(
    "resolves and runs a .cmd shim (npm) on Windows",
    async () => {
      const result = await runTool("npm", ["--version"], tmpdir());
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\./);
    },
  );
});

describe("splitArgs", () => {
  it("splits on whitespace and drops empties", () => {
    expect(splitArgs("  npm   install ")).toEqual(["npm", "install"]);
  });
});
