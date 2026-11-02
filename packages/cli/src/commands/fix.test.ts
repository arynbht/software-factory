import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runFix } from "./fix.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("runFix (integration)", () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });

  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "factory-fix-"));
    made.push(dir);
    return dir;
  }

  it("dry-run previews file creates without touching disk", async () => {
    const dir = await tempRepo();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });

    const code = await runFix(dir, { gate: "scaffold" }, { token: null });

    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toMatch(/create/);
    expect(text).toMatch(/--write/);
    // Nothing should have been written in dry-run mode.
    expect(await exists(join(dir, "README.md"))).toBe(false);
  });

  it("--write materialises files on disk", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runFix(
      dir,
      { gate: "scaffold", write: true },
      { token: null },
    );

    expect(code).toBe(0);
    expect(await exists(join(dir, "README.md"))).toBe(true);
  });

  it("running twice is idempotent (second run makes no file changes)", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runFix(dir, { gate: "scaffold", write: true }, { token: null });

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const code = await runFix(
      dir,
      { gate: "scaffold", write: true },
      { token: null },
    );

    expect(code).toBe(0);
    expect(out.join("")).toMatch(/0 file changes/);
  });

  it("errors on an unknown control", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runFix(
      dir,
      { control: "nope.not-real" },
      { token: null },
    );
    expect(code).toBe(1);
  });

  it("errors on an unknown gate", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runFix(dir, { gate: "nope" }, { token: null });
    expect(code).toBe(1);
  });

  it("fails fast on a nonexistent path", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runFix(
      join(tmpdir(), "factory-fix-definitely-missing-xyz"),
      {},
      { token: null },
    );
    expect(code).toBe(1);
  });
});
