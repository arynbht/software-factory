import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadState,
  managedFileUnchanged,
  managedHash,
  normalizeContent,
  saveState,
  sha256,
} from "./state.js";

const BOM = String.fromCharCode(0xfeff);

describe("state", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-state-"));
    made.push(d);
    return d;
  };

  it("returns a fresh state when there is no file", async () => {
    expect(await loadState(await tmp())).toEqual({ version: 1 });
  });

  it("round-trips and preserves fields", async () => {
    const dir = await tmp();
    await saveState(dir, {
      version: 1,
      managed: { "a.txt": "hash" },
      summary: 7,
    });
    const loaded = await loadState(dir);
    expect(loaded.managed).toEqual({ "a.txt": "hash" });
    expect(loaded.summary).toBe(7);
  });

  it("recovers from a corrupt state file", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".factory"), { recursive: true });
    await writeFile(join(dir, ".factory", "state.json"), "{not json", "utf8");
    expect(await loadState(dir)).toEqual({ version: 1 });
  });

  describe("managedFileUnchanged", () => {
    it("is false for a file the factory never wrote", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "f.txt"), "human", "utf8");
      expect(await managedFileUnchanged(dir, "f.txt", { version: 1 })).toBe(
        false,
      );
    });

    it("is true when recorded and unchanged, false when edited", async () => {
      const dir = await tmp();
      await writeFile(join(dir, "f.txt"), "ours", "utf8");
      const state = { version: 1, managed: { "f.txt": sha256("ours") } };
      expect(await managedFileUnchanged(dir, "f.txt", state)).toBe(true);
      await writeFile(join(dir, "f.txt"), "edited", "utf8");
      expect(await managedFileUnchanged(dir, "f.txt", state)).toBe(false);
    });

    it("is true when recorded but the file was deleted", async () => {
      const dir = await tmp();
      const state = { version: 1, managed: { "gone.txt": "h" } };
      expect(await managedFileUnchanged(dir, "gone.txt", state)).toBe(true);
    });

    it("matches a factory-written file checked out with CRLF or a BOM", async () => {
      const dir = await tmp();
      // Registry records the LF hash the factory wrote...
      const state = { version: 1, managed: { "f.txt": managedHash("a\nb\n") } };
      // ...but git (autocrlf) or an editor hands it back as CRLF / BOM+CRLF.
      await writeFile(join(dir, "f.txt"), "a\r\nb\r\n", "utf8");
      expect(await managedFileUnchanged(dir, "f.txt", state)).toBe(true);
      await writeFile(join(dir, "f.txt"), `${BOM}a\r\nb\r\n`, "utf8");
      expect(await managedFileUnchanged(dir, "f.txt", state)).toBe(true);
      // A genuine content edit is still detected.
      await writeFile(join(dir, "f.txt"), "a\r\nc\r\n", "utf8");
      expect(await managedFileUnchanged(dir, "f.txt", state)).toBe(false);
    });
  });

  describe("normalizeContent", () => {
    it("strips a leading BOM and converts CRLF to LF", () => {
      expect(normalizeContent(`${BOM}a\r\nb`)).toBe("a\nb");
    });
    it("managedHash is EOL/BOM-insensitive and equals sha256 of the LF form", () => {
      expect(managedHash("a\r\nb")).toBe(sha256("a\nb"));
      expect(managedHash(`${BOM}a\nb`)).toBe(sha256("a\nb"));
    });
  });
});
