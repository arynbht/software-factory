import { describe, expect, it } from "vitest";

import { endOfDayMs } from "./dates.js";

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
});
