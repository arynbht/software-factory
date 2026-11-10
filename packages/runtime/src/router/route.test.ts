// The router against the factory's real manifests: the §13 step-5 cases, the
// §5.3 rules, and what approval re-checks in an edited assembly.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifests, type Manifest } from "@arynbht/factory-registry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Card, parseCard } from "../task/card.js";
import { route, type RouteInput, validateAssembly } from "./route.js";

let manifests: Map<string, Manifest>;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "factory-router-"));
  ({ manifests } = await loadManifests(dir));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Every shipped skill, minus the two blocked at sync (scan findings, 2026-11-09). */
const synced = () =>
  new Set(
    [...manifests.keys()].filter(
      (n) => n !== "impeccable" && n !== "taste-skill",
    ),
  );
const CHECKS = [
  "quality.lint.clean",
  "quality.typecheck.clean",
  "quality.tests.pass",
];

function card(fields: Partial<Card> & Pick<Card, "title">): Card {
  return parseCard({
    id: "T-0142",
    type: "feature",
    description: fields.title,
    acceptance: [{ id: "A1", text: "It works", verify: "e2e" }],
    owner: "dev@example.com",
    created: "2026-11-10",
    ...fields,
  });
}

const SETTINGS = card({
  title: "Redesign the settings page",
  description:
    "The settings page is dense and inconsistent. Rebuild it on the design system, keep every existing setting, no new backend calls.",
  touches: ["src/app/settings/**", "src/components/settings/**"],
});
const WEB_APP: Omit<RouteInput, "card" | "manifests"> = {
  available: new Set(),
  flags: { "public-facing": true },
  files: [
    "src/app/settings/page.tsx",
    "src/components/settings/Panel.tsx",
    "src/components/settings/panel.css",
    "src/server/orders.ts",
    "src/server/db/orders-repo.ts",
  ],
  checks: CHECKS,
};

describe("router", () => {
  it("routes a settings redesign to ui + a11y with a critique, a11y and proof skills", () => {
    const { assembly, notes } = route({
      ...WEB_APP,
      card: SETTINGS,
      manifests,
      available: synced(),
    });
    expect(assembly.sectors).toEqual(["ui", "a11y"]);
    expect(assembly.phases).toEqual([
      "brief",
      "build",
      "polish",
      "prove",
      "review",
    ]);
    // frontend-design is the critique skill while impeccable is blocked;
    // hallmark (new pages) doesn't load on the public-facing flag alone.
    expect(assembly.skills).toEqual([
      "a11y-core",
      "accessibility-lead",
      "frontend-design",
    ]);
    expect(assembly.skills).not.toContain("taste-skill");
    expect(assembly.spine).toContain("playwright-cli");
    expect(assembly.proof).toBe("ui-screenshots");
    expect(assembly.review.design_pass).toBe(true);
    expect(assembly.budget.skill_tokens).toBe(5000 + 1500 + 5500);
    expect(assembly.budget.steps).toBe(12);
    expect(notes).toContain(
      "impeccable matched but isn't available (not locked, not synced, or blocked at sync)",
    );
  });

  it("with impeccable available, it wins: one critique skill, no fallback (§5.3)", () => {
    const { assembly, notes } = route({
      ...WEB_APP,
      card: SETTINGS,
      manifests,
      available: new Set([...synced(), "impeccable", "taste-skill"]),
    });
    expect(assembly.skills).toEqual([
      "impeccable",
      "a11y-core",
      "accessibility-lead",
    ]);
    expect(assembly.spine).toContain("playwright-cli");
    expect(notes).toContain(
      "frontend-design left out: a critique skill is already in the assembly",
    );
    expect(notes.some((n) => n.startsWith("taste-skill left out"))).toBe(true);
  });

  it("taste-skill wins when the card names it", () => {
    const { assembly } = route({
      ...WEB_APP,
      card: card({
        title: "Redesign the settings page",
        description: "Use taste-skill for the critique.",
        touches: SETTINGS.touches,
      }),
      manifests,
      available: new Set([...synced(), "impeccable", "taste-skill"]),
    });
    expect(assembly.skills[0]).toBe("taste-skill");
    expect(assembly.skills).not.toContain("impeccable");
  });

  it("routes an N+1 fix to data + api with no UI skill", () => {
    const { assembly } = route({
      ...WEB_APP,
      card: card({
        title: "Fix N+1 in orders query",
        type: "fix",
        description: "Loading the orders list runs one query per order.",
      }),
      manifests,
      available: synced(),
    });
    expect(assembly.sectors).toEqual(["data", "api"]);
    expect(assembly.phases).toEqual(["build", "prove", "review"]);
    for (const name of assembly.skills)
      expect(manifests.get(name)?.sectors).not.toContain("ui");
    expect(assembly.spine).not.toContain("playwright-cli");
    expect(assembly.proof).toBe("test-run");
    expect(assembly.review.design_pass).toBe(false);
    // No vendored data skill yet (factory-data is to be written): a gap.
    expect(assembly.gaps).toEqual([
      "data: no vendored skill covers it; the agent works from the spine",
    ]);
  });

  it("a schema change makes data's proof a migration dry-run", () => {
    const { assembly } = route({
      ...WEB_APP,
      card: card({
        title: "Add a column for the order's currency",
        description: "A migration adding orders.currency, backfilled to USD.",
      }),
      manifests,
      available: synced(),
    });
    expect(assembly.sectors).toContain("data");
    expect(assembly.proof).toBe("migration-dry-run");
  });

  it("a single keyword in the description is shown as borderline, not guessed", () => {
    const routing = route({
      ...WEB_APP,
      card: card({
        title: "Speed up the export job",
        description: "The export is slow for large accounts.",
      }),
      manifests,
      available: synced(),
    });
    expect(routing.assembly.sectors).not.toContain("perf");
    expect(routing.borderline).toContain("perf");
  });

  it("brings in legal only alongside data when the profile handles PII", () => {
    const pii = { ...WEB_APP, flags: { "handles-pii": true } };
    const data = route({
      ...pii,
      card: card({ title: "Fix N+1 in orders query", type: "fix" }),
      manifests,
      available: synced(),
    });
    expect(data.assembly.sectors).toContain("legal");
    const docs = route({
      ...pii,
      card: card({ title: "Fix a typo in the README docs", type: "fix" }),
      manifests,
      available: synced(),
    });
    expect(docs.assembly.sectors).not.toContain("legal");
  });

  it("never loads more than four task skills", () => {
    const { assembly } = route({
      ...WEB_APP,
      card: card({
        title: "Redesign the landing page with animation and new docs copy",
        description:
          "New page from scratch: hallmark layout, motion and transitions, accessibility pass, docs copy, data retention notice for privacy.",
        touches: SETTINGS.touches,
      }),
      manifests,
      available: synced(),
      flags: { "public-facing": true, "handles-pii": true },
    });
    expect(assembly.skills.length).toBeLessThanOrEqual(4);
  });
});

describe("validateAssembly", () => {
  const routed = () =>
    route({ ...WEB_APP, card: SETTINGS, manifests, available: synced() })
      .assembly;
  const check = (assembly: unknown, available = synced()) =>
    validateAssembly(assembly, {
      task: "T-0142",
      manifests,
      available,
      checks: CHECKS,
    }).problems;

  it("accepts what the router produced", () => {
    expect(check(routed())).toEqual([]);
  });

  it("refuses conflicting, unavailable or incomplete skills and unknown checks", () => {
    const a = routed();
    expect(
      check(
        { ...a, skills: ["impeccable", "taste-skill"] },
        new Set([...synced(), "impeccable", "taste-skill"]),
      ),
    ).toEqual([
      "skills: impeccable conflicts with taste-skill",
      "skills: one critique skill per task",
    ]);
    expect(check({ ...a, skills: ["impeccable"] })).toEqual([
      "skills: impeccable isn't available (lock and sync it first)",
    ]);
    expect(check({ ...a, skills: ["accessibility-lead"] })).toEqual([
      "skills: accessibility-lead requires a11y-core",
    ]);
    expect(check({ ...a, skills: ["playwright-cli"] })).toEqual([
      "skills: playwright-cli is a spine skill; list it under spine",
    ]);
    expect(check({ ...a, checks: ["a11y.axe.clean"] })).toEqual([
      "checks: a11y.axe.clean isn't a check the judge can run",
    ]);
  });

  it("refuses a fifth skill and a schema slip", () => {
    const a = routed();
    expect(check({ ...a, skills: ["a", "b", "c", "d", "e"] })[0]).toMatch(
      /^skills: /,
    );
    expect(check({ ...a, proof: "vibes" })[0]).toMatch(/^proof: /);
  });
});
