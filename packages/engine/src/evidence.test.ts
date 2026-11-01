import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  findValidEvidence,
  isEvidenceValid,
  loadEvidence,
  parseDuration,
  type EvidenceEntry,
} from "./evidence.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
);
const NOW = new Date("2026-11-01T00:00:00Z");

describe("parseDuration", () => {
  it("parses days, weeks, and years", () => {
    expect(parseDuration("365d")).toBe(365);
    expect(parseDuration("26w")).toBe(182);
    expect(parseDuration("1y")).toBe(365);
    expect(parseDuration("90")).toBe(90);
  });

  it("returns null for garbage", () => {
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("isEvidenceValid", () => {
  const entry = (over: Partial<EvidenceEntry>): EvidenceEntry => ({
    control: "x.y.z",
    ...over,
  });

  it("is invalid without a date", () => {
    expect(isEvidenceValid(entry({}), NOW)).toBe(false);
  });

  it("is valid when dated and within the window", () => {
    expect(
      isEvidenceValid(entry({ date: "2026-10-01", "valid-for": "365d" }), NOW),
    ).toBe(true);
  });

  it("is invalid when expired", () => {
    expect(
      isEvidenceValid(entry({ date: "2020-01-01", "valid-for": "30d" }), NOW),
    ).toBe(false);
  });

  it("never expires without a valid-for window", () => {
    expect(isEvidenceValid(entry({ date: "2000-01-01" }), NOW)).toBe(true);
  });

  it("fails closed on an unparseable valid-for (no immortal evidence)", () => {
    expect(
      isEvidenceValid(
        entry({ date: "2026-10-01", "valid-for": "3 months" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("loadEvidence + findValidEvidence", () => {
  it("loads entries and filters by validity", async () => {
    const entries = await loadEvidence(resolve(fixtures, "node-complete"));
    expect(entries.length).toBe(2);
    expect(findValidEvidence(entries, "sec.threat-model", NOW)).not.toBeNull();
    expect(
      findValidEvidence(entries, "a11y.screen-reader-pass", NOW),
    ).toBeNull();
    expect(findValidEvidence(entries, "no.such.control", NOW)).toBeNull();
  });

  it("returns none for a repo without an evidence file", async () => {
    expect(await loadEvidence(resolve(fixtures, "empty"))).toEqual([]);
  });
});
