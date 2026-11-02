import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "./fs-atomic.js";

describe("writeFileAtomic", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-atomic-"));
    made.push(d);
    return d;
  };

  it("creates a new file", async () => {
    const dir = await tmp();
    await writeFileAtomic(join(dir, "a.txt"), "hello");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "a.txt"), "old", "utf8");
    await writeFileAtomic(join(dir, "a.txt"), "new");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("new");
  });

  it("creates missing parent directories", async () => {
    const dir = await tmp();
    const nested = join(dir, "x", "y", "z.txt");
    await writeFileAtomic(nested, "deep");
    expect(await readFile(nested, "utf8")).toBe("deep");
  });

  it("leaves no temp file behind", async () => {
    const dir = await tmp();
    await writeFileAtomic(join(dir, "a.txt"), "x");
    const entries = await readdir(dir);
    expect(entries).toEqual(["a.txt"]);
  });

  it("is last-wins under concurrent writers (never interleaves)", async () => {
    const dir = await tmp();
    const target = join(dir, "a.txt");
    await Promise.all([
      writeFileAtomic(target, "aaaa"),
      writeFileAtomic(target, "bbbb"),
      writeFileAtomic(target, "cccc"),
    ]);
    const out = await readFile(target, "utf8");
    // Whichever won, the file is one complete write, not a mix.
    expect(["aaaa", "bbbb", "cccc"]).toContain(out);
  });
});
