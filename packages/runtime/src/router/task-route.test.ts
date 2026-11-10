// The route beat on a real task record: proposal, approval, and that the
// approved assembly is sealed like the card.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifests } from "@arynbht/factory-registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  confirmTask,
  loadTask,
  newTask,
  nextStep,
  sha256,
} from "../task/tasks.js";
import {
  approveRoute,
  type RouteContext,
  routeTask,
  routingContext,
} from "./task-route.js";

const made: string[] = [];
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
let repo: string;
let context: RouteContext;
const savedConfig = process.env.FACTORY_CONFIG_DIR;

beforeEach(async () => {
  process.env.FACTORY_CONFIG_DIR = await tmp("factory-config-");
  repo = await tmp("factory-route-");
  const { manifests } = await loadManifests(repo);
  context = {
    manifests,
    available: new Set(
      [...manifests.keys()].filter(
        (n) => n !== "impeccable" && n !== "taste-skill",
      ),
    ),
    flags: { "public-facing": true },
    files: ["src/components/settings/Panel.tsx"],
    checks: ["quality.lint.clean", "quality.tests.pass"],
  };
});
afterEach(async () => {
  if (savedConfig === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = savedConfig;
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

const by = { by: "dev@example.com", now: new Date("2026-11-10T15:00:00Z") };

async function confirmedTask(): Promise<string> {
  const draft = await newTask(
    repo,
    {
      title: "Redesign the settings page",
      type: "feature",
      description: "Rebuild settings on the design system.",
      acceptance: [{ id: "A1", text: "Every setting works", verify: "e2e" }],
      touches: ["src/components/settings/**"],
    },
    by,
  );
  await confirmTask(repo, draft.card.id, by);
  return draft.card.id;
}

describe("task route and approve", () => {
  it("won't route an unconfirmed card", async () => {
    const draft = await newTask(
      repo,
      {
        title: "Redesign the settings page",
        type: "feature",
        description: "x",
        acceptance: [{ id: "A1", text: "y", verify: "e2e" }],
      },
      by,
    );
    await expect(
      routeTask(repo, draft.card.id, { ...by, context }),
    ).rejects.toThrow(/isn't confirmed yet/);
  });

  it("proposes, records why, and seals the assembly on approval", async () => {
    const id = await confirmedTask();
    const { task, routing } = await routeTask(repo, id, { ...by, context });
    expect(routing.assembly.sectors).toEqual(["ui", "a11y"]);
    expect(task.approved).toBe(false);
    expect(nextStep(task)).toMatch(/^route: review assembly.yml/);
    const ledger = await readFile(task.ledger.mdPath, "utf8");
    expect(ledger).toContain("routed to ui, a11y: ui (touches");
    expect(ledger).toContain("assembly proposed; sha256 ");

    const approved = await approveRoute(repo, id, { ...by, context });
    expect(approved.task.approved).toBe(true);
    expect(approved.task.problems).toEqual([]);
    expect(nextStep(approved.task)).toBe("isolate");
    await expect(routeTask(repo, id, { ...by, context })).rejects.toThrow(
      /already approved/,
    );
  });

  it("catches an edit to assembly.yml after approval", async () => {
    const id = await confirmedTask();
    await routeTask(repo, id, { ...by, context });
    await approveRoute(repo, id, { ...by, context });
    const path = join(repo, ".factory/tasks", id, "assembly.yml");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("steps: 12", "steps: 99"),
    );
    const task = await loadTask(repo, id);
    expect(task.problems).toEqual([
      "assembly.yml changed after the route was approved",
    ]);
    expect(nextStep(task)).toMatch(/^stop/);
  });

  it("re-checks a human's edit before approving it, and records it", async () => {
    const id = await confirmedTask();
    await routeTask(repo, id, { ...by, context });
    const path = join(repo, ".factory/tasks", id, "assembly.yml");
    const original = await readFile(path, "utf8");

    // Dropping a skill another one requires is refused.
    await writeFile(path, original.replace("  - a11y-core\n", ""));
    await expect(approveRoute(repo, id, { ...by, context })).rejects.toThrow(
      "skills: accessibility-lead requires a11y-core",
    );

    // A valid edit is approved, and the ledger says it was edited.
    await writeFile(path, original.replace("steps: 12", "steps: 8"));
    const { task, assembly } = await approveRoute(repo, id, {
      ...by,
      context,
    });
    expect(assembly.budget.steps).toBe(8);
    expect(await readFile(task.ledger.mdPath, "utf8")).toContain(
      "assembly edited before approval",
    );
  });

  it("refuses to approve an assembly that changed after it was shown", async () => {
    const id = await confirmedTask();
    const { task } = await routeTask(repo, id, { ...by, context });
    const shown = sha256(task.assemblyText ?? "");
    const path = join(repo, ".factory/tasks", id, "assembly.yml");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("steps: 12", "steps: 8"),
    );
    await expect(
      approveRoute(repo, id, { ...by, context, shown }),
    ).rejects.toThrow("assembly.yml changed while it was being approved");
  });

  it("refuses to route on skills that weren't synced", async () => {
    await mkdir(join(repo, ".factory"), { recursive: true });
    await writeFile(
      join(repo, ".factory/skills.lock"),
      [
        "version: 1",
        "skills:",
        "  - name: frontend-design",
        "    source: anthropics/skills/skills/frontend-design",
        `    pin: ${"a".repeat(40)}`,
        `    hash: "sha256:${"b".repeat(64)}"`,
        "    scope: task",
        "",
      ].join("\n"),
    );
    await expect(routingContext(repo)).rejects.toThrow(
      "skills have never been synced",
    );
    // A sync of an older lock is just as stale.
    await writeFile(
      join(repo, ".factory/skills.state.json"),
      JSON.stringify({
        syncedAt: "2026-11-09T00:00:00Z",
        lock: "0".repeat(64),
        skills: [],
        blocked: [],
      }),
    );
    await expect(routingContext(repo)).rejects.toThrow(
      "the skills lock changed since the last sync",
    );
  });

  it("reads an unlocked repo as no skills, the profile's flags, and the judge's checks", async () => {
    await mkdir(join(repo, ".factory"), { recursive: true });
    await writeFile(
      join(repo, ".factory/profile.yml"),
      "version: 1\nname: demo\ntype: web-app\nflags:\n  public-facing: true\n",
    );
    const read = await routingContext(repo);
    expect(read.available.size).toBe(0);
    expect(read.flags?.["public-facing"]).toBe(true);
    expect(read.files).toEqual([]); // not a git repo
    expect(read.checks).toContain("quality.tests.pass");
    expect(read.manifests.has("frontend-design")).toBe(true);
  });

  it("won't approve before routing, or an assembly that isn't YAML", async () => {
    const id = await confirmedTask();
    await expect(approveRoute(repo, id, { ...by, context })).rejects.toThrow(
      "hasn't been routed",
    );
    await routeTask(repo, id, { ...by, context });
    await writeFile(
      join(repo, ".factory/tasks", id, "assembly.yml"),
      "skills: [unclosed\n",
    );
    await expect(approveRoute(repo, id, { ...by, context })).rejects.toThrow(
      "isn't valid YAML",
    );
  });

  it("records borderline sectors for the approver", async () => {
    const draft = await newTask(
      repo,
      {
        title: "Speed up the export job",
        type: "feature",
        description: "The export is slow for large accounts.",
        acceptance: [{ id: "A1", text: "Exports in under 5s", verify: "e2e" }],
      },
      by,
    );
    await confirmTask(repo, draft.card.id, by);
    const { task } = await routeTask(repo, draft.card.id, { ...by, context });
    expect(await readFile(task.ledger.mdPath, "utf8")).toContain(
      "under the threshold, for the approver: perf",
    );
  });
});
