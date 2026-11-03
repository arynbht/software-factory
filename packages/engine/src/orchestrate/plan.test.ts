import { describe, expect, it } from "vitest";

import type { AuditContext } from "../context.js";
import { planFeature } from "./plan.js";

// planFeature only reads ctx.repoPath (and loadFloorPlan, which returns null for a
// nonexistent repo) — a minimal stub is enough.
const ctx = { repoPath: "/no-such-repo" } as AuditContext;

describe("planFeature", () => {
  it("normalizes the planner reply into a BuildPlan", async () => {
    const plan = await planFeature(ctx, "add CSV export", {
      planner: () =>
        Promise.resolve({
          summary: "add an export endpoint",
          affectedSystems: ["API"],
          tasks: [
            {
              title: "add route",
              detail: "new handler",
              paths: ["src/api.ts"],
            },
          ],
          acceptanceCriteria: ["GET /export returns CSV"],
          risks: ["large datasets"],
        }),
    });
    expect(plan.request).toBe("add CSV export");
    expect(plan.summary).toBe("add an export endpoint");
    expect(plan.affectedSystems).toEqual(["API"]);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.paths).toEqual(["src/api.ts"]);
    expect(plan.acceptanceCriteria[0]).toMatch(/CSV/);
    expect(plan.risks).toEqual(["large datasets"]);
  });

  it("tolerates a sparse / malformed reply", async () => {
    const plan = await planFeature(ctx, "fix the bug", {
      planner: () => Promise.resolve({}),
    });
    expect(plan.request).toBe("fix the bug");
    expect(plan.tasks).toEqual([]);
    expect(plan.affectedSystems).toEqual([]);
  });

  it("feeds the request and the architecture into the planner prompt", async () => {
    let seen = "";
    await planFeature(ctx, "add a widget", {
      planner: (spec) => {
        seen = spec.prompt;
        return Promise.resolve({});
      },
    });
    expect(seen).toContain("add a widget");
    expect(seen).toContain("floor plan");
  });
});
