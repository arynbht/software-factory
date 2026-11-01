import type { Control, Predicate, Profile } from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import { appliesTo, evaluatePredicate } from "./applicability.js";

const profile = (over: Partial<Profile> = {}): Profile =>
  ({
    version: 1,
    name: "x",
    type: "web-app",
    stack: ["typescript", "react"],
    phase: "build",
    flags: { "public-facing": true, "handles-pii": false },
    "severity-floor": "low",
    ...over,
  }) as Profile;

const control = (over: Partial<Control>): Control =>
  ({
    id: "repo.x.y",
    title: "t",
    lane: "hygiene",
    phase: "scaffold",
    severity: "medium",
    detect: [{ type: "manual" }],
    evidence: "none",
    references: [{ name: "r", url: "https://e.com" }],
    rationale: "r",
    ...over,
  }) as Control;

describe("evaluatePredicate", () => {
  const p = profile();
  const check = (pred: Predicate): boolean => evaluatePredicate(pred, p);

  it("matches flags, type, and stack", () => {
    expect(check({ flag: "public-facing" })).toBe(true);
    expect(check({ flag: "handles-pii" })).toBe(false);
    expect(check({ type: "web-app" })).toBe(true);
    expect(check({ type: "cli" })).toBe(false);
    expect(check({ stack: "react" })).toBe(true);
    expect(check({ stack: "vue" })).toBe(false);
  });

  it("handles phase-at-least by lifecycle order", () => {
    expect(check({ "phase-at-least": "design" })).toBe(true); // build >= design
    expect(check({ "phase-at-least": "launch" })).toBe(false); // build < launch
  });

  it("composes all / any / not", () => {
    expect(
      check({ all: [{ type: "web-app" }, { flag: "public-facing" }] }),
    ).toBe(true);
    expect(check({ all: [{ type: "web-app" }, { flag: "handles-pii" }] })).toBe(
      false,
    );
    expect(check({ any: [{ type: "cli" }, { flag: "public-facing" }] })).toBe(
      true,
    );
    expect(check({ not: { flag: "handles-pii" } })).toBe(true);
  });

  it("treats an empty predicate as applicable", () => {
    expect(check({})).toBe(true);
  });
});

describe("appliesTo", () => {
  it("applies to everything with no profile", () => {
    expect(appliesTo(control({ applies: { flag: "handles-pii" } }), null)).toBe(
      true,
    );
  });

  it("applies when there is no predicate", () => {
    expect(appliesTo(control({}), profile())).toBe(true);
  });

  it("respects the predicate", () => {
    expect(
      appliesTo(control({ applies: { flag: "public-facing" } }), profile()),
    ).toBe(true);
    expect(
      appliesTo(control({ applies: { flag: "handles-pii" } }), profile()),
    ).toBe(false);
  });

  it("is not applicable when its lane is toggled off", () => {
    expect(
      appliesTo(
        control({ lane: "hygiene" }),
        profile({ lanes: { hygiene: false } }),
      ),
    ).toBe(false);
  });
});
