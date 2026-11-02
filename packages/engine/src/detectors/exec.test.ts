import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveOnWindows,
  runTool,
  splitArgs,
  ToolNotFoundError,
} from "./exec.js";

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

  it("passes an argument containing spaces as a single token", async () => {
    // Regression: a shell-based launch split "hello world" into two args, and the
    // repo path (e.g. "…\\Software Factory - Dev") would break the same way.
    const result = await runTool(
      "node",
      ["-e", "process.stdout.write(process.argv[1])", "hello world"],
      tmpdir(),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
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

// resolveOnWindows is platform-agnostic logic (it just consults PATH/PATHEXT and
// the filesystem), so we can exercise it on any OS by controlling the environment.
describe("resolveOnWindows", () => {
  const made: string[] = [];
  const savedPath = process.env.PATH;
  const savedExt = process.env.PATHEXT;
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    process.env.PATH = savedPath;
    process.env.PATHEXT = savedExt;
  });

  // Lowercase PATHEXT + lowercase filenames so the candidate `tool.cmd` matches on
  // both case-sensitive (Linux CI) and case-insensitive (Windows) filesystems.
  it("resolves a .cmd shim and ignores a coexisting extensionless file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-which-"));
    made.push(dir);
    // A bare `tool` (bash shim) next to `tool.cmd` — only the .cmd is runnable.
    await writeFile(join(dir, "tool"), "#!/bin/sh\n", "utf8");
    await writeFile(join(dir, "tool.cmd"), "@echo off\n", "utf8");
    process.env.PATH = dir;
    process.env.PATHEXT = ".com;.exe;.bat;.cmd";

    const resolved = await resolveOnWindows("tool");
    expect(resolved).toBe(join(dir, "tool.cmd"));
  });

  it("returns null when nothing with an executable extension is found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-which-"));
    made.push(dir);
    await writeFile(join(dir, "tool"), "#!/bin/sh\n", "utf8"); // bare only
    process.env.PATH = dir;
    process.env.PATHEXT = ".com;.exe;.bat;.cmd";

    expect(await resolveOnWindows("tool")).toBeNull();
    expect(await resolveOnWindows("absent")).toBeNull();
  });

  it("honours an explicit extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-which-"));
    made.push(dir);
    await writeFile(join(dir, "tool.exe"), "MZ", "utf8");
    process.env.PATH = dir;
    process.env.PATHEXT = ".com;.exe;.bat;.cmd";

    expect(await resolveOnWindows("tool.exe")).toBe(join(dir, "tool.exe"));
  });

  it("does not resolve a bare command from the current working directory", async () => {
    // A malicious repo can drop a `scorecard.cmd` in its root; tools run with
    // `cwd = repoPath`, so resolving against CWD would be a code-execution hijack.
    // The resolver must consult PATH only.
    const dir = await mkdtemp(join(tmpdir(), "factory-cwd-"));
    made.push(dir);
    await writeFile(join(dir, "tool.cmd"), "@echo off\n", "utf8");
    const savedCwd = process.cwd();
    try {
      process.chdir(dir); // the tool now sits in CWD but not on PATH
      process.env.PATH = ""; // nothing on PATH
      process.env.PATHEXT = ".com;.exe;.bat;.cmd";
      expect(await resolveOnWindows("tool")).toBeNull();
    } finally {
      process.chdir(savedCwd);
    }
  });
});
