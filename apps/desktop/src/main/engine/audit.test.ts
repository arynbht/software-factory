import { describe, expect, it } from "vitest";

import { runAudit } from "./audit";

// The adapter imports only the engine + catalog (no electron), so it runs as a
// plain integration test against the factory repo itself — the same thing
// `factory audit .` does — and proves the scorecard shape the renderer consumes.
describe("runAudit (desktop adapter)", () => {
  it("produces a lane scorecard for the factory repo", async () => {
    const card = await runAudit(process.cwd());

    expect(card.totals.total).toBeGreaterThan(0);
    expect(card.lanes.length).toBeGreaterThan(0);

    // The six status counts partition the total exactly.
    const summed = card.lanes.reduce((n, lane) => {
      const c = lane.counts;
      return n + c.pass + c.fail + c.needsEvidence + c.waived + c.skip + c.na;
    }, 0);
    expect(summed).toBe(card.totals.total);

    // Every lane returned has at least one control, in catalog order.
    expect(card.lanes.every((lane) => lane.controls.length > 0)).toBe(true);

    // The adapter evaluates applicability against the real repo: the factory has
    // no datastore and doesn't handle PII, so data.migrations-versioned is n/a.
    const controls = card.lanes.flatMap((lane) => lane.controls);
    const migration = controls.find(
      (c) => c.controlId === "data.migrations-versioned",
    );
    expect(migration?.status).toBe("n/a");

    // Joined control metadata is populated (rationale/references for the expand).
    const security = card.lanes.find((lane) => lane.key === "security");
    expect(security).toBeDefined();
    expect(security?.controls.every((c) => c.rationale.length > 0)).toBe(true);
  });
});
