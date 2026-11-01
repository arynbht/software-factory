import type { Gate } from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import type { ControlResult, ControlStatus } from "./evaluate.js";
import { evaluateGate, selectForGate } from "./gates.js";

const result = (over: Partial<ControlResult>): ControlResult => ({
  controlId: "repo.readme.present",
  title: "t",
  lane: "hygiene",
  phase: "scaffold",
  severity: "medium",
  status: "pass",
  detectors: [],
  durationMs: 0,
  ...over,
});

const gate = (select: Gate["select"]): Gate => ({ phase: "build", select });

describe("selectForGate", () => {
  const results = [
    result({
      controlId: "repo.readme.present",
      phase: "scaffold",
      lane: "hygiene",
    }),
    result({
      controlId: "sec.sast.ci",
      phase: "harden",
      lane: "security",
      severity: "high",
    }),
    result({
      controlId: "test.x",
      phase: "build",
      lane: "testing",
      severity: "low",
    }),
  ];

  it("selects by phase", () => {
    const got = selectForGate(gate([{ phase: "scaffold" }]), results);
    expect(got.map((r) => r.controlId)).toEqual(["repo.readme.present"]);
  });

  it("selects by id", () => {
    const got = selectForGate(gate([{ id: "sec.sast.ci" }]), results);
    expect(got.map((r) => r.controlId)).toEqual(["sec.sast.ci"]);
  });

  it("selects by lane and minSeverity", () => {
    const got = selectForGate(
      gate([{ lane: "security", minSeverity: "high" }]),
      results,
    );
    expect(got.map((r) => r.controlId)).toEqual(["sec.sast.ci"]);
    // low-severity testing control is excluded by minSeverity: high
    expect(
      selectForGate(gate([{ lane: "testing", minSeverity: "high" }]), results),
    ).toEqual([]);
  });

  it("unions multiple selectors without duplicates", () => {
    const got = selectForGate(
      gate([{ phase: "scaffold" }, { lane: "hygiene" }]),
      results,
    );
    expect(got).toHaveLength(1);
  });
});

describe("evaluateGate", () => {
  const withStatuses = (statuses: ControlStatus[]): ControlResult[] =>
    statuses.map((status, i) => result({ controlId: `c.${i}.x`, status }));

  it("is green when all pass or n/a", () => {
    expect(
      evaluateGate(gate([{ phase: "scaffold" }]), withStatuses(["pass", "n/a"]))
        .status,
    ).toBe("green");
  });

  it("is red when any control fails", () => {
    expect(
      evaluateGate(
        gate([{ phase: "scaffold" }]),
        withStatuses(["pass", "fail"]),
      ).status,
    ).toBe("red");
  });

  it("is amber when none fail but some need evidence or skip", () => {
    expect(
      evaluateGate(
        gate([{ phase: "scaffold" }]),
        withStatuses(["pass", "needs-evidence"]),
      ).status,
    ).toBe("amber");
    expect(
      evaluateGate(
        gate([{ phase: "scaffold" }]),
        withStatuses(["pass", "skip"]),
      ).status,
    ).toBe("amber");
  });
});
