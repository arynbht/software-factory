import type { ControlResult } from "@arynbht/factory-engine";
import { describe, expect, it } from "vitest";

import { exitCodeFor, renderReport, summarize } from "./report.js";

function result(over: Partial<ControlResult>): ControlResult {
  return {
    controlId: "repo.readme.present",
    title: "README present",
    lane: "hygiene",
    phase: "scaffold",
    severity: "medium",
    status: "pass",
    detectors: [],
    durationMs: 1,
    ...over,
  };
}

const sample: ControlResult[] = [
  result({ controlId: "repo.readme.present", status: "pass" }),
  result({ controlId: "sec.sast-ci", lane: "security", status: "fail" }),
  result({
    controlId: "sec.threat-model",
    lane: "security",
    status: "needs-evidence",
  }),
  result({ controlId: "repo.license.present", status: "skip" }),
];

describe("summarize", () => {
  it("counts each status", () => {
    expect(summarize(sample)).toEqual({
      pass: 1,
      fail: 1,
      needsEvidence: 1,
      waived: 0,
      skip: 1,
      na: 0,
      total: 4,
    });
  });
});

describe("exitCodeFor", () => {
  it("is 1 when a critical control fails", () => {
    expect(
      exitCodeFor([result({ severity: "critical", status: "fail" })]),
    ).toBe(1);
  });

  it("is 0 when failures are non-critical", () => {
    expect(exitCodeFor([result({ severity: "high", status: "fail" })])).toBe(0);
    expect(
      exitCodeFor([result({ severity: "critical", status: "pass" })]),
    ).toBe(0);
  });
});

describe("renderReport", () => {
  it("renders parseable JSON", () => {
    const parsed = JSON.parse(renderReport(sample, { format: "json" }));
    expect(parsed.summary.total).toBe(4);
    expect(parsed.controls).toHaveLength(4);
  });

  it("renders a table with a summary line", () => {
    const table = renderReport(sample, { format: "table", color: false });
    expect(table).toContain("security");
    expect(table).toContain("sec.sast-ci");
    expect(table).toContain("1 pass, 1 fail, 1 need evidence, 1 skip");
    expect(table).toContain("(4 controls)");
  });

  it("handles an empty result set", () => {
    const table = renderReport([], { format: "table", color: false });
    expect(table).toContain("No controls");
    expect(table).toContain("(0 controls)");
  });
});
