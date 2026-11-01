import { describe, expect, it } from "vitest";

import { GateSchema } from "./gate.js";

describe("GateSchema", () => {
  it("accepts a gate with selectors", () => {
    const result = GateSchema.safeParse({
      phase: "scaffold",
      title: "Scaffold gate",
      select: [
        { phase: "scaffold" },
        { lane: "security", minSeverity: "high" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a selector with no fields", () => {
    expect(GateSchema.safeParse({ phase: "build", select: [{}] }).success).toBe(
      false,
    );
  });

  it("rejects an unknown phase", () => {
    expect(
      GateSchema.safeParse({ phase: "nope", select: [{ phase: "build" }] })
        .success,
    ).toBe(false);
  });

  it("requires at least one selector", () => {
    expect(GateSchema.safeParse({ phase: "build", select: [] }).success).toBe(
      false,
    );
  });
});
