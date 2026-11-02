import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfile, loadWaivers } from "@arynbht/factory-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runEvidenceAdd } from "./evidence.js";
import { runProfileSet, runProfileShow } from "./profile.js";
import { runWaive } from "./waive.js";

describe("profile / waive / evidence commands", () => {
  const made: string[] = [];
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });
  const repo = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-cmd-"));
    made.push(d);
    const { saveProfile } = await import("@arynbht/factory-engine");
    await saveProfile(d, { version: 1, name: "x", type: "cli" });
    return d;
  };

  it("profile set updates a field and round-trips", async () => {
    const dir = await repo();
    expect(await runProfileSet("type", "library", dir)).toBe(0);
    expect(await runProfileSet("flags.handles-pii", "true", dir)).toBe(0);
    const p = await loadProfile(dir);
    expect(p?.type).toBe("library");
    expect(p?.flags["handles-pii"]).toBe(true);
  });

  it("profile set rejects an unknown key and an invalid value", async () => {
    const dir = await repo();
    expect(await runProfileSet("bogus", "x", dir)).toBe(1);
    expect(await runProfileSet("type", "webapp", dir)).toBe(1);
  });

  it("profile set rejects a non-boolean flag value instead of coercing it", async () => {
    const dir = await repo();
    expect(await runProfileSet("flags.handles-pii", "yes", dir)).toBe(1);
    // The flag must be untouched (not silently set to false).
    const p = await loadProfile(dir);
    expect(p?.flags["handles-pii"]).toBeUndefined();
  });

  it("profile show returns 1 when there is no profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-cmd-"));
    made.push(dir);
    expect(await runProfileShow(dir)).toBe(1);
  });

  it("waive requires reason and expires, then writes a waiver", async () => {
    const dir = await repo();
    expect(await runWaive("a.b.c", {}, dir, "2026-11-01")).toBe(1); // no reason
    expect(await runWaive("a.b.c", { reason: "x" }, dir, "2026-11-01")).toBe(1); // no expires
    expect(
      await runWaive(
        "a.b.c",
        { reason: "scratch", expires: "2027-01-01" },
        dir,
        "2026-11-01",
      ),
    ).toBe(0);
    const waivers = await loadWaivers(dir);
    expect(waivers[0]?.control).toBe("a.b.c");
  });

  it("evidence add requires a url or file, then writes an entry", async () => {
    const dir = await repo();
    expect(
      await runEvidenceAdd("sec.threat-model", {}, dir, "2026-11-01"),
    ).toBe(1);
    expect(
      await runEvidenceAdd(
        "sec.threat-model",
        { url: "https://example.com/tm", validFor: "365d" },
        dir,
        "2026-11-01",
      ),
    ).toBe(0);
    const raw = await readFile(join(dir, ".factory", "evidence.yml"), "utf8");
    expect(raw).toContain("sec.threat-model");
    expect(raw).toContain("365d");
  });
});
