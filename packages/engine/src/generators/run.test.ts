import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildContext } from "../context.js";
import { generators } from "./registry.js";
import { planControl, planControls } from "./run.js";

const control = (over: Partial<Control> = {}): Control =>
  ({
    id: "c.x.y",
    title: "t",
    lane: "cicd",
    phase: "build",
    severity: "low",
    detect: [{ type: "file-exists", path: "x" }],
    evidence: "none",
    references: [{ name: "r", url: "https://e.com" }],
    rationale: "r",
    fix: { type: "template", template: "whatever" },
    ...over,
  }) as Control;

const ctx = buildContext("/tmp/x");

describe("planControl error handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("collects a generator throw instead of swallowing it", async () => {
    vi.spyOn(generators, "template").mockRejectedValue(
      new Error("Eta syntax error"),
    );
    const { changes, errors } = await planControl(ctx, control());
    expect(changes).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      controlId: "c.x.y",
      fixType: "template",
      message: "Eta syntax error",
    });
  });

  it("returns no error for a control without a fix", async () => {
    const { changes, errors } = await planControl(
      ctx,
      control({ fix: undefined }),
    );
    expect(changes).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("planControls aggregates changes and errors across controls", async () => {
    vi.spyOn(generators, "template").mockRejectedValue(new Error("boom"));
    const { changes, errors } = await planControls(ctx, [
      control({ id: "a.b.c" }),
      control({ id: "d.e.f" }),
    ]);
    expect(changes).toEqual([]);
    expect(errors.map((e) => e.controlId)).toEqual(["a.b.c", "d.e.f"]);
  });
});
