import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifyCheck } from "./types.js";
import { verify } from "./verify.js";

const skipGate = (): Promise<VerifyCheck> =>
  Promise.resolve({
    name: "factory-gate",
    passed: true,
    ran: false,
    output: "skip",
  });

describe("verify", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "verify-"));
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", typecheck: "tsc" } }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs present scripts, skips absent ones, and passes when all green", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "" }),
    );
    const result = await verify(dir, { run, gate: skipGate });

    expect(result.passed).toBe(true);
    const byName = new Map(result.checks.map((c) => [c.name, c]));
    expect(byName.get("typecheck")?.ran).toBe(true);
    expect(byName.get("test")?.ran).toBe(true);
    expect(byName.get("lint")?.ran).toBe(false); // not in package.json
    // Uses the lockfile-detected package manager.
    expect(run).toHaveBeenCalledWith("pnpm", ["run", "typecheck"], dir);
  });

  it("fails overall when a script exits non-zero", async () => {
    const run = vi.fn((_bin, args: string[]) =>
      Promise.resolve(
        args[1] === "test"
          ? { exitCode: 1, stdout: "", stderr: "1 failing" }
          : { exitCode: 0, stdout: "", stderr: "" },
      ),
    );
    const result = await verify(dir, { run, gate: skipGate });
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "test")?.passed).toBe(false);
  });

  it("fails when the factory gate is red", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    );
    const gate = (): Promise<VerifyCheck> =>
      Promise.resolve({
        name: "factory-gate",
        passed: false,
        ran: true,
        output: "red",
      });
    const result = await verify(dir, { run, gate });
    expect(result.passed).toBe(false);
  });
});

describe("verify runs repo code without the caller's secrets", () => {
  let dir: string;
  const saved = process.env.FACTORY_TEST_SECRET;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "verify-env-"));
    process.env.FACTORY_TEST_SECRET = "s3cret-from-the-caller";
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.FACTORY_TEST_SECRET;
    else process.env.FACTORY_TEST_SECRET = saved;
    await rm(dir, { recursive: true, force: true });
  });

  it("a script can't read a variable outside the allowlist", async () => {
    await writeFile(join(dir, "package-lock.json"), "{}");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          test: 'node -e "process.exit(process.env.FACTORY_TEST_SECRET ? 1 : 0)"',
        },
      }),
    );
    const result = await verify(dir, { scripts: ["test"], gate: skipGate });
    expect(result.checks[0]).toMatchObject({ name: "test", ran: true });
    expect(result.passed).toBe(true);
  }, 30_000);
});
