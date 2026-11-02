import { describe, expect, it } from "vitest";

import { endOfDayMs, startOfDayMs } from "./dates.js";

describe("endOfDayMs", () => {
  it("treats a bare date as inclusive end of day (UTC)", () => {
    expect(endOfDayMs("2026-11-01")).toBe(
      Date.parse("2026-11-01T23:59:59.999Z"),
    );
  });

  it("uses a full datetime as-is", () => {
    expect(endOfDayMs("2026-11-01T08:00:00Z")).toBe(
      Date.parse("2026-11-01T08:00:00Z"),
    );
  });

  it("returns null for an unparseable date", () => {
    expect(endOfDayMs("whenever")).toBeNull();
  });

  it("parses a zone-less datetime as UTC (not the host local timezone)", () => {
    // A waiver/evidence expiry written as 2026-11-01T00:00:00 must mean the
    // same instant on a laptop and in CI. V8 parses a zone-less datetime in
    // the host local timezone, so the engine must not trust Date.parse for it.
    expect(endOfDayMs("2026-11-01T00:00:00")).toBe(
      Date.parse("2026-11-01T00:00:00Z"),
    );
  });
});

describe("startOfDayMs", () => {
  it("treats a bare date as the start of day (UTC)", () => {
    expect(startOfDayMs("2026-11-01")).toBe(Date.parse("2026-11-01T00:00:00Z"));
  });

  it("parses a zone-less datetime as the start of that day (UTC)", () => {
    expect(startOfDayMs("2026-11-01T08:00:00")).toBe(
      Date.parse("2026-11-01T00:00:00Z"),
    );
  });

  it("keeps a datetime with an explicit offset and floors it to UTC day start", () => {
    expect(startOfDayMs("2026-11-01T23:00:00Z")).toBe(
      Date.parse("2026-11-01T00:00:00Z"),
    );
  });

  it("returns null for an unparseable date", () => {
    expect(startOfDayMs("whenever")).toBeNull();
  });
});
