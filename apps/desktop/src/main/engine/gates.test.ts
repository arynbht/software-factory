import { describe, expect, it } from "vitest";

import { computeGates } from "./gates";

// Electron-free, so it runs as a plain integration test against the factory repo.
describe("computeGates (desktop adapter)", () => {
  it("computes phase gates and an inferred phase for the factory repo", async () => {
    const report = await computeGates(process.cwd());

    expect(report.phases.length).toBeGreaterThan(0);
    // At least one phase has a defined gate (non-null status).
    expect(report.phases.some((p) => p.status !== null)).toBe(true);

    // The inferred phase, when set, is flagged on exactly that phase.
    if (report.inferredPhase) {
      const inferred = report.phases.filter((p) => p.inferred);
      expect(inferred).toHaveLength(1);
      expect(inferred[0]?.phase).toBe(report.inferredPhase);
    }

    // The factory waives data.migrations-versioned, so the build gate is not red.
    const build = report.phases.find((p) => p.phase === "build");
    expect(build).toBeDefined();
    expect(build?.status).not.toBe("red");

    // Every blocker is a fail or needs-evidence control.
    for (const phase of report.phases) {
      for (const b of phase.blockers) {
        expect(["fail", "needs-evidence"]).toContain(b.status);
      }
    }
  });
});
