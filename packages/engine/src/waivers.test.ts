import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Waiver } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import {
  addWaiver,
  findActiveWaiver,
  isWaiverActive,
  loadWaivers,
  waiversExpiringWithin,
  WaiverError,
} from "./waivers.js";

const NOW = new Date("2026-11-01T00:00:00Z");
const waiver = (over: Partial<Waiver>): Waiver => ({
  control: "repo.readme.present",
  reason: "scratch repo",
  expires: "2027-01-01",
  ...over,
});

describe("isWaiverActive / findActiveWaiver", () => {
  it("is active before expiry and inactive after", () => {
    expect(isWaiverActive(waiver({ expires: "2027-01-01" }), NOW)).toBe(true);
    expect(isWaiverActive(waiver({ expires: "2026-01-01" }), NOW)).toBe(false);
  });

  it("stays active through the whole expiry day (not just until midnight)", () => {
    const afternoon = new Date("2026-11-01T14:00:00Z");
    expect(isWaiverActive(waiver({ expires: "2026-11-01" }), afternoon)).toBe(
      true,
    );
  });

  it("is inactive for an unparseable expiry", () => {
    expect(isWaiverActive(waiver({ expires: "whenever" }), NOW)).toBe(false);
  });

  it("finds the active waiver for a control", () => {
    const waivers = [
      waiver({ control: "a.b.c", expires: "2026-01-01" }),
      waiver({ control: "repo.readme.present", expires: "2027-01-01" }),
    ];
    expect(findActiveWaiver(waivers, "repo.readme.present", NOW)?.control).toBe(
      "repo.readme.present",
    );
    expect(findActiveWaiver(waivers, "a.b.c", NOW)).toBeNull(); // expired
  });
});

describe("waiversExpiringWithin", () => {
  it("returns only waivers expiring inside the window", () => {
    const waivers = [
      waiver({ control: "soon", expires: "2026-11-20" }),
      waiver({ control: "later", expires: "2027-06-01" }),
      waiver({ control: "past", expires: "2026-01-01" }),
    ];
    const soon = waiversExpiringWithin(waivers, 30, NOW).map((w) => w.control);
    expect(soon).toEqual(["soon"]);
  });
});

describe("loadWaivers / addWaiver", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-waiver-"));
    made.push(d);
    return d;
  };

  it("returns none when there is no file", async () => {
    expect(await loadWaivers(await tmp())).toEqual([]);
  });

  it("adds a waiver that round-trips, replacing the same control", async () => {
    const dir = await tmp();
    await addWaiver(dir, waiver({ reason: "first" }));
    await addWaiver(dir, waiver({ reason: "second" }));
    const loaded = await loadWaivers(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.reason).toBe("second");
    expect(
      await readFile(join(dir, ".factory", "waivers.yml"), "utf8"),
    ).toContain("repo.readme.present");
  });

  it("throws WaiverError on an invalid waivers file", async () => {
    const dir = await tmp();
    await addWaiver(dir, waiver({}));
    // Corrupt it: write a non-array.
    await rm(join(dir, ".factory", "waivers.yml"));
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".factory"), { recursive: true });
    await writeFile(
      join(dir, ".factory", "waivers.yml"),
      "control: x\n",
      "utf8",
    );
    await expect(loadWaivers(dir)).rejects.toBeInstanceOf(WaiverError);
  });

  it("rejects a waiver whose control is not a control id", async () => {
    const dir = await tmp();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".factory"), { recursive: true });
    // A Markdown-injection payload masquerading as a control reference.
    await writeFile(
      join(dir, ".factory", "waivers.yml"),
      '- control: "x` [pwn](https://evil)"\n  reason: r\n  expires: 2099-01-01\n',
      "utf8",
    );
    await expect(loadWaivers(dir)).rejects.toBeInstanceOf(WaiverError);
  });
});
