// `factory task run`: from an approved route to a draft PR in one call, stopping
// wherever a person is needed.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifests } from "@arynbht/factory-registry";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentCall } from "../agent/build.js";
import type { reviewLocal } from "../judge/review.js";
import type { Tier1Options, Tier1Result } from "../judge/tier1.js";
import {
  approveRoute,
  type RouteContext,
  routeTask,
} from "../router/task-route.js";
import type { LedgerEntry } from "./ledger.js";
import { MAX_BUILDS_PER_RUN, runTask } from "./run.js";
import { confirmTask, newTask } from "./tasks.js";

const made: string[] = [];
const savedConfig = process.env.FACTORY_CONFIG_DIR;
const by = { by: "dev@example.com", now: new Date("2026-11-10T18:00:00Z") };
let context: RouteContext;

const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
beforeEach(async () => {
  process.env.FACTORY_CONFIG_DIR = await tmp("factory-config-");
});
afterEach(async () => {
  if (savedConfig === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = savedConfig;
  for (const d of made) {
    await simpleGit(d)
      .raw(["worktree", "prune"])
      .catch(() => undefined);
    await rm(d, { recursive: true, force: true });
  }
  made.length = 0;
});

const BASE = {
  "package.json": `${JSON.stringify({ name: "demo", scripts: { test: "node --test" } }, null, 2)}\n`,
  "src/total.js": "exports.total = () => 0;\n",
};

async function approvedTask(): Promise<{ repo: string; id: string }> {
  const repo = await tmp("factory-run-");
  const git = simpleGit(repo);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  for (const [path, text] of Object.entries(BASE)) {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  await git.add(["-A"]);
  await git.commit("base", ["--no-verify"]);
  const { manifests } = await loadManifests(repo);
  context = {
    manifests,
    available: new Set(),
    flags: {},
    files: Object.keys(BASE),
    checks: ["quality.tests.pass"],
  };
  const draft = await newTask(
    repo,
    {
      title: "Fix total so it sums",
      type: "fix",
      description: "total() returns 0; it should sum its list.",
      acceptance: [{ id: "A1", text: "total sums a list", verify: "unit" }],
    },
    by,
  );
  const id = draft.card.id;
  await confirmTask(repo, id, by);
  await routeTask(repo, id, { ...by, context });
  await approveRoute(repo, id, { ...by, context });
  return { repo, id };
}

const fix = async (cwd: string, test = "a.equal(total([1, 2, 3]), 6)") => {
  await writeFile(
    join(cwd, "src/total.js"),
    "exports.total = (l) => l.reduce((a, b) => a + b, 0);\n",
  );
  await writeFile(
    join(cwd, "src/total.test.js"),
    `const t = require("node:test"); const a = require("node:assert"); const { total } = require("./total.js");\nt.test("sums", () => ${test});\n`,
  );
};

const tier1 = async (o: Tier1Options): Promise<Tier1Result> => ({
  verdict: "pass",
  base: o.base,
  head: o.head ?? "",
  mergeBase: (
    await simpleGit(o.repoPath).raw(["merge-base", o.base, o.head ?? "HEAD"])
  ).trim(),
  changedFiles: 2,
  protected: [],
  checks: [],
  notes: [],
  workDir: "",
});
const review: typeof reviewLocal = async (o) => ({
  verdict: "approve",
  round: o.round ?? 1,
  body: "ok",
  result: {
    verdict: "approve",
    blocking: [],
    suggestions: [],
    acceptance: [{ id: "A1", status: "met", note: "" }],
    unreviewed: [],
    model: "judge-model",
    calls: 1,
    usage: { tokens: 10, costUsd: 0.01 },
    packed: {
      files: [],
      omitted: [],
      lines: new Map(),
      agents: null,
      constraints: null,
    },
  },
});

describe("runTask", { timeout: 180_000 }, () => {
  it("takes an approved task to a draft PR and reports every ledger entry", async () => {
    const { repo, id } = await approvedTask();
    const seen: LedgerEntry[] = [];
    const titles: string[] = [];
    const outcome = await runTask(repo, id, {
      ...by,
      base: "main",
      onEntry: (e) => seen.push(e),
      agent: async (call: AgentCall) => {
        if (call.mode === "plan")
          return JSON.stringify({ steps: ["fix total"] });
        await fix(call.cwd);
        return "fixed";
      },
      judge: { tier1, review },
      ship: {
        push: async () => undefined,
        openPr: async (p) => {
          titles.push(p.title);
          return { number: 7, url: "https://x/pull/7", reused: false };
        },
        postReview: async () => "https://x/pull/7#pullrequestreview-1",
      },
    });
    expect(outcome.ran).toEqual(["isolate", "build", "prove", "judge", "ship"]);
    expect(outcome.next).toMatch(/^close: once the PR is merged/);
    expect(titles).toEqual(["fix: fix total so it sums"]);
    // Every entry the run wrote was reported, in order, and nothing else.
    const beats = [...new Set(seen.map((e) => e.beat))];
    expect(beats).toEqual(["isolate", "build", "prove", "judge", "ship"]);
    expect(seen.map((e) => e.seq)).toEqual(
      seen.map((_, i) => (seen[0]?.seq ?? 0) + i),
    );
  });

  it("stops at a stop-and-ask question", async () => {
    const { repo, id } = await approvedTask();
    const outcome = await runTask(repo, id, {
      ...by,
      base: "main",
      agent: async (call) => {
        if (call.mode === "plan")
          return JSON.stringify({ steps: ["add lodash"] });
        const pkg = JSON.parse(
          await readFile(join(call.cwd, "package.json"), "utf8"),
        ) as Record<string, unknown>;
        await writeFile(
          join(call.cwd, "package.json"),
          JSON.stringify({ ...pkg, dependencies: { lodash: "^4.17.21" } }),
        );
        return "added lodash";
      },
    });
    expect(outcome.ran).toEqual(["isolate", "build"]);
    expect(outcome.next).toMatch(/^stop-and-ask/);
  });

  it("hands the task back after too many build rounds", async () => {
    const { repo, id } = await approvedTask();
    let builds = 0;
    const outcome = await runTask(repo, id, {
      ...by,
      base: "main",
      agent: async (call) => {
        if (call.mode === "plan")
          return JSON.stringify({ steps: ["fix total"] });
        builds++;
        // A test that never passes: every proof fails.
        await fix(call.cwd, "a.equal(1, 2)");
        return "tried";
      },
    });
    expect(builds).toBe(MAX_BUILDS_PER_RUN);
    expect(outcome.next).toMatch(/^stopped after 4 build rounds/);
  });

  it("won't start before a person has approved the route", async () => {
    const repo = await tmp("factory-run-");
    await simpleGit(repo).init(["-b", "main"]);
    const draft = await newTask(
      repo,
      {
        title: "Something",
        type: "chore",
        description: "Something.",
        acceptance: [{ id: "A1", text: "done", verify: "manual" }],
      },
      by,
    );
    await expect(runTask(repo, draft.card.id, by)).rejects.toThrow(
      "needs a person first: intake",
    );
  });
});
