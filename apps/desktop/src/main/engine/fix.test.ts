import { describe, expect, it } from "vitest";

import { planFix } from "./fix";

// Electron-free; dry-run only, so it writes nothing to the repo.
describe("planFix (desktop adapter)", () => {
  it("returns a dry-run plan for the factory repo", async () => {
    const plan = await planFix(process.cwd());

    expect(Array.isArray(plan.changes)).toBe(true);
    expect(Array.isArray(plan.generatorErrors)).toBe(true);
    for (const change of plan.changes) {
      expect([
        "create",
        "update",
        "skip",
        "unchanged",
        "suggest",
        "effect",
      ]).toContain(change.action);
      expect(change.controlId.length).toBeGreaterThan(0);
    }
  });
});
