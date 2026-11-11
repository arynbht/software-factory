// The judge, ship and close beats on real repos: a passing judge ships a draft
// PR built from the card, ledger, proof and judge record; blocking findings go
// back to the agent twice, then to a person; close waits for a person to merge,
// then records the outcome, removes the worktree and seals the ledger.
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadHistory, type OpenPrParams } from "@arynbht/factory-engine";
import { loadManifests } from "@arynbht/factory-registry";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AgentCall, answerStops, buildTask } from "../agent/build.js";
import { isolateTask, loadIsolation } from "../agent/isolate.js";
import { roundVerdict, type reviewLocal } from "../judge/review.js";
import { judgeTask } from "../judge/task-judge.js";
import type { Tier1Options, Tier1Result } from "../judge/tier1.js";
import type { Finding, Tier2Result } from "../judge/tier2.js";
import { proveTask } from "../proof/prove.js";
import {
  approveRoute,
  type RouteContext,
  routeTask,
} from "../router/task-route.js";
import {
  confirmTask,
  loadTask,
  newTask,
  nextStep,
  TASKS_DIR,
} from "../task/tasks.js";
import { closeTask, usageTotals } from "./close.js";
import { prTitle, shipTask } from "./ship.js";

const made: string[] = [];
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
const savedConfig = process.env.FACTORY_CONFIG_DIR;
const by = { by: "dev@example.com", now: new Date("2026-11-10T18:00:00Z") };
const later = new Date("2026-11-10T20:38:00Z");
let context: RouteContext;

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
const FIXED = "exports.total = (l) => l.reduce((a, b) => a + b, 0);\n";
const TEST =
  'const t = require("node:test"); const a = require("node:assert"); const { total } = require("./total.js");\nt.test("sums", () => a.equal(total([1, 2, 3]), 6));\n';

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await tmp("factory-ship-");
  const git = simpleGit(repo);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  for (const [path, text] of Object.entries(files)) {
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
    files: Object.keys(files),
    checks: ["quality.tests.pass"],
  };
  return repo;
}

/** An agent that writes the fix (and its test), and records every call. */
function scriptedAgent(calls: AgentCall[]) {
  return async (call: AgentCall) => {
    calls.push(call);
    if (call.mode === "plan")
      return { text: JSON.stringify({ steps: ["fix total"] }), tokens: 1200 };
    await writeFile(join(call.cwd, "src/total.js"), FIXED);
    await writeFile(join(call.cwd, "src/total.test.js"), TEST);
    return { text: "fixed total", tokens: 50_000, costUsd: 0.4 };
  };
}

/** Intake to a passing proof: the task is ready for the judge. */
async function proved(repo: string, calls: AgentCall[] = []): Promise<string> {
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
  await isolateTask(repo, id, { ...by, base: "main" });
  const outcome = await buildTask(repo, id, {
    ...by,
    agent: scriptedAgent(calls),
  });
  expect(outcome.stops).toEqual([]);
  const { record } = await proveTask(repo, id, by);
  expect(record.passed).toBe(true);
  return id;
}

/** Tier 1 as the judge would report it, without cloning or installing. */
function fakeTier1(
  verdict: Tier1Result["verdict"],
  extra: Partial<Tier1Result> = {},
) {
  const seen: Tier1Options[] = [];
  const run = async (o: Tier1Options): Promise<Tier1Result> => {
    seen.push(o);
    const git = simpleGit(o.repoPath);
    const mergeBase = (
      await git.raw(["merge-base", o.base, o.head ?? "HEAD"])
    ).trim();
    return {
      verdict,
      base: o.base,
      head: o.head ?? "",
      mergeBase,
      changedFiles: 2,
      protected: [],
      checks: [
        {
          id: "quality.tests.pass",
          title: "Tests pass",
          base: "green",
          head: verdict === "fail" ? "red" : "green",
          outcome: verdict === "fail" ? "fail" : "pass",
          message: verdict === "fail" ? "1 test failed: sums" : "",
        },
      ],
      notes: [],
      workDir: "",
      ...extra,
    };
  };
  return Object.assign(run, { seen });
}

const blockingFinding: Finding = {
  kind: "defect",
  file: "src/total.js",
  line: 1,
  acceptance_id: null,
  title: "total of an empty list throws",
  detail: "reduce without a seed",
  repro: "call total([]) and it throws a TypeError on the empty array",
  fix: "seed the reduce with 0",
};

/** Tier 2 with a fixed set of findings; the verdict follows the round rules. */
function fakeReview(blocking: Finding[]): typeof reviewLocal {
  return async (o) => {
    const result: Tier2Result = {
      verdict: blocking.length > 0 ? "request-changes" : "approve",
      blocking,
      suggestions: [
        {
          ...blockingFinding,
          kind: "suggestion",
          title: "name the reducer's arguments",
        },
      ],
      acceptance: [
        {
          id: "A1",
          status: blocking.length > 0 ? "unmet" : "met",
          note: "src/total.test.js",
        },
      ],
      unreviewed: [],
      model: "judge-model",
      calls: 1,
      usage: { tokens: 8000, costUsd: 0.12 },
      packed: {
        files: [],
        omitted: [],
        lines: new Map(),
        agents: null,
        constraints: null,
      },
    };
    const round = o.round ?? 1;
    const verdict = roundVerdict(result, round);
    return { verdict, round, result, body: `review round ${round}` };
  };
}

describe("judge, ship, close", { timeout: 180_000 }, () => {
  it("a passing judge ships a draft PR, and close seals the ledger once it's merged", async () => {
    const repo = await repoWith(BASE);
    const id = await proved(repo);
    const tier1 = fakeTier1("pass");
    const judged = await judgeTask(repo, id, {
      ...by,
      tier1,
      review: fakeReview([]),
    });
    expect(judged.record.verdict).toBe("passed");
    // The judge ran on the task's branch from the worktree's base, with the
    // assembly's checks — never in the worktree.
    const iso = (await loadIsolation(repo, id))!;
    expect(tier1.seen[0]).toMatchObject({
      repoPath: repo,
      base: iso.base,
      checks: ["quality.tests.pass"],
    });
    expect(nextStep(judged.task)).toBe("ship");

    // Ship: a draft PR whose body comes from the card, proof and judge.
    const pushed: string[] = [];
    const opened: OpenPrParams[] = [];
    const shipped = await shipTask(repo, id, {
      ...by,
      push: async (i) => {
        pushed.push(i.branch);
      },
      openPr: async (p) => {
        opened.push(p);
        return {
          number: 12,
          url: "https://github.com/o/r/pull/12",
          reused: false,
        };
      },
    });
    expect(pushed).toEqual([`fix/${id.toLowerCase()}`]);
    const pr = opened[0]!;
    expect(pr).toMatchObject({
      draft: true,
      base: "main",
      head: `fix/${id.toLowerCase()}`,
      title: "fix: fix total so it sums",
    });
    expect(pr.body).toContain("total() returns 0; it should sum its list.");
    expect(pr.body).toContain("| A1 | total sums a list | unit | ✅ met");
    expect(pr.body).toMatch(/## Proof\n\nPassed · test-run\n\n- tests passed/);
    expect(pr.body).toContain("- `A` src/total.test.js");
    expect(pr.body).toContain("- `M` src/total.js");
    expect(pr.body).toContain("1 suggestion(s), non-blocking");
    expect(pr.body).toContain(
      "- Iterations: 1 build round(s) · 1 judge round(s) · 0 stop-and-ask question(s)",
    );
    expect(nextStep(shipped.task)).toMatch(/^close: once the PR is merged/);

    // Close waits for a person to merge.
    await expect(
      closeTask(repo, id, {
        ...by,
        prState: async () => ({ state: "open", merged: false }),
      }),
    ).rejects.toThrow("PR #12 is still open");
    const { task, row } = await closeTask(repo, id, {
      by: by.by,
      now: later,
      prState: async (n) => {
        expect(n).toBe(12);
        return {
          state: "closed",
          merged: true,
          mergedBy: "alice",
          mergedAt: "2026-11-10T20:30:00Z",
        };
      },
    });
    expect(row).toMatchObject({
      kind: "task",
      task: id,
      outcome: "merged",
      pr: 12,
      minutes: 158,
      tokens: 1200 + 50_000 + 8000,
      cost_usd: 0.52,
      build_rounds: 1,
      judge_rounds: 1,
    });
    const md = await readFile(task.ledger.mdPath, "utf8");
    expect(md).toContain(
      "PR #12 merged by alice 2026-11-10 20:30 · 2h38m · 59k tokens · $0.52",
    );
    expect(nextStep(task)).toBe("done");
    // The worktree and the merged branch are gone; the ledger takes nothing more.
    await expect(access(iso.worktree)).rejects.toThrow();
    expect(await simpleGit(repo).branchLocal()).toMatchObject({
      all: ["main"],
    });
    await expect(
      task.ledger.append({
        beat: "close",
        section: "timeline",
        text: "more",
        by: "x",
      }),
    ).rejects.toThrow("sealed");
    await expect(closeTask(repo, id, by)).rejects.toThrow("already closed");
    // The task row shares history.jsonl without disturbing the posture trend.
    const lines = (
      await readFile(join(repo, ".factory", "history.jsonl"), "utf8")
    ).trim();
    expect(JSON.parse(lines)).toMatchObject({ kind: "task", task: id });
    expect(await loadHistory(repo)).toEqual([]);
  });

  it("blocking findings go back to the agent twice, then to a person", async () => {
    const repo = await repoWith(BASE);
    const calls: AgentCall[] = [];
    const id = await proved(repo, calls);
    const review = fakeReview([blockingFinding]);
    const round = async (n: number) => {
      const { task, record } = await judgeTask(repo, id, {
        ...by,
        tier1: fakeTier1("pass"),
        review,
      });
      expect(record.round).toBe(n);
      return { task, record };
    };

    for (const n of [1, 2]) {
      const { task, record } = await round(n);
      expect(record.verdict).toBe("failed");
      expect(nextStep(task)).toMatch(
        /^build: .*the judge sent the change back/,
      );
      calls.length = 0;
      await buildTask(repo, id, { ...by, agent: scriptedAgent(calls) });
      // The agent is told exactly what blocked, with the repro.
      expect(calls[0]?.mode).toBe("build");
      expect(calls[0]?.prompt).toContain(
        "the judge sent the change back; fix these and nothing else — blocking defect src/total.js:1 — total of an empty list throws · repro: call total([]) and it throws",
      );
      expect(calls[0]?.prompt).toContain("acceptance A1: unmet");
      // The agent changed nothing this round, so the proof runs on the same commit.
      await proveTask(repo, id, by);
    }

    const { task, record } = await round(3);
    expect(record.verdict).toBe("needs a human");
    expect(nextStep(task)).toMatch(/^stop-and-ask/);
    await expect(shipTask(repo, id, by)).rejects.toThrow("isn't ready to ship");
    const answered = await answerStops(repo, id, {
      allow: true,
      note: "the empty list never happens here",
      by: "lead@example.com",
    });
    expect(nextStep(answered)).toBe("ship");
    const opened: OpenPrParams[] = [];
    await shipTask(repo, id, {
      ...by,
      push: async () => undefined,
      openPr: async (p) => {
        opened.push(p);
        return { number: 3, url: "u", reused: false };
      },
    });
    expect(opened[0]?.body).toContain("Blocking findings a person accepted:");
    expect(opened[0]?.body).toContain(
      "| A1 | total sums a list | unit | ❌ unmet",
    );
  });

  it("a protected change skips the review and asks a person; a denial rebuilds", async () => {
    const repo = await repoWith(BASE);
    const calls: AgentCall[] = [];
    const id = await proved(repo, calls);
    let reviewed = false;
    const { task, record } = await judgeTask(repo, id, {
      ...by,
      tier1: fakeTier1("needs-human", {
        protected: [
          {
            path: "package.json",
            reason: "scripts",
            detail: "package.json scripts changed",
          },
        ],
      }),
      review: async (o) => {
        reviewed = true;
        return fakeReview([])(o);
      },
    });
    expect(reviewed).toBe(false);
    expect(record.verdict).toBe("needs a human");
    expect(record.review).toBeUndefined();
    expect(nextStep(task)).toMatch(/^stop-and-ask/);
    const denied = await answerStops(repo, id, {
      allow: false,
      note: "put the test script back",
      by: "lead@example.com",
    });
    expect(nextStep(denied)).toMatch(/^build: .*a person sent the change back/);
    calls.length = 0;
    await buildTask(repo, id, { ...by, agent: scriptedAgent(calls) });
    expect(calls[0]?.prompt).toContain("denied — put the test script back");
  });

  it("tier 1 failing goes back to build without paying for a review", async () => {
    const repo = await repoWith(BASE);
    const calls: AgentCall[] = [];
    const id = await proved(repo, calls);
    const { task, record } = await judgeTask(repo, id, {
      ...by,
      tier1: fakeTier1("fail"),
      review: () => {
        throw new Error("the review must not run");
      },
    });
    expect(record.verdict).toBe("failed");
    expect(nextStep(task)).toMatch(/^build/);
    calls.length = 0;
    await buildTask(repo, id, { ...by, agent: scriptedAgent(calls) });
    expect(calls[0]?.prompt).toContain(
      "tier 1 fail: quality.tests.pass — 1 test failed: sums",
    );
  });

  it("won't ship a branch that moved after the verdict, or a tampered judge record", async () => {
    const repo = await repoWith(BASE);
    const id = await proved(repo);
    await judgeTask(repo, id, {
      ...by,
      tier1: fakeTier1("pass"),
      review: fakeReview([]),
    });
    const record = join(repo, TASKS_DIR, id, "judge", "round-1.json");
    const text = await readFile(record, "utf8");
    await writeFile(record, text.replace('"passed"', '"passed" '));
    await expect(shipTask(repo, id, by)).rejects.toThrow(
      "doesn't match the record sealed in the ledger",
    );
    await writeFile(record, text);

    const iso = (await loadIsolation(repo, id))!;
    await writeFile(join(iso.worktree, "extra.js"), "1;\n");
    const wt = simpleGit(iso.worktree);
    await wt.add(["-A"]);
    await wt.commit("sneak", ["--no-verify"]);
    await expect(shipTask(repo, id, by)).rejects.toThrow(
      "moved after the judge's verdict",
    );
  });

  it("the judge won't run on a commit the last build round didn't make", async () => {
    const repo = await repoWith(BASE);
    const id = await proved(repo);
    const iso = (await loadIsolation(repo, id))!;
    await writeFile(join(iso.worktree, "extra.js"), "1;\n");
    const wt = simpleGit(iso.worktree);
    await wt.add(["-A"]);
    await wt.commit("sneak", ["--no-verify"]);
    await expect(
      judgeTask(repo, id, {
        ...by,
        tier1: fakeTier1("pass"),
        review: fakeReview([]),
      }),
    ).rejects.toThrow("build and prove again");
  });

  it("a task can be abandoned before it ships; the unmerged branch is kept", async () => {
    const repo = await repoWith(BASE);
    const id = await proved(repo);
    await expect(closeTask(repo, id, by)).rejects.toThrow("has no PR yet");
    const { task, row } = await closeTask(repo, id, {
      ...by,
      abandon: "superseded by T-0009",
    });
    expect(row).toMatchObject({ outcome: "abandoned", pr: null });
    const md = await readFile(task.ledger.mdPath, "utf8");
    expect(md).toContain("abandoned: superseded by T-0009");
    expect(md).toMatch(/worktree removed · branch fix\/t-0001 kept/);
    expect((await simpleGit(repo).branchLocal()).all).toContain("fix/t-0001");
    expect(nextStep(await loadTask(repo, id))).toBe("done");
  });

  it("an unmerged worktree with uncommitted edits is kept, not forced away", async () => {
    const repo = await repoWith(BASE);
    const id = await proved(repo);
    const iso = (await loadIsolation(repo, id))!;
    await writeFile(join(iso.worktree, "src/total.js"), "// half done\n");
    const { task } = await closeTask(repo, id, { ...by, abandon: "" });
    await access(iso.worktree);
    expect(await readFile(join(iso.worktree, "src/total.js"), "utf8")).toBe(
      "// half done\n",
    );
    expect(await readFile(task.ledger.mdPath, "utf8")).toContain(
      "kept: it has uncommitted edits",
    );
  });

  it("a draft card can be abandoned, and then reads as done", async () => {
    const repo = await repoWith(BASE);
    const draft = await newTask(
      repo,
      {
        title: "Never mind",
        type: "chore",
        description: "Not needed after all.",
        acceptance: [{ id: "A1", text: "n/a", verify: "manual" }],
      },
      by,
    );
    const { task } = await closeTask(repo, draft.card.id, {
      ...by,
      abandon: "not needed",
    });
    expect(nextStep(task)).toBe("done");
  });

  it("a close that stopped part-way finishes without recording twice", async () => {
    const repo = await repoWith(BASE);
    const id = await proved(repo);
    const first = await loadTask(repo, id);
    // As if close had written its outcome and then died.
    await first.ledger.append({
      beat: "close",
      section: "outcome",
      text: "PR #4 merged by alice · 1h00m · 1k tokens · $0.10",
      by: "factory runtime",
    });
    expect(nextStep(await loadTask(repo, id))).toMatch(/stopped part-way/);
    const { task, row } = await closeTask(repo, id, {
      ...by,
      prState: () => {
        throw new Error("the outcome is decided; don't ask GitHub again");
      },
    });
    expect(row.outcome).toBe("merged");
    expect(task.entries.filter((e) => e.section === "outcome")).toHaveLength(1);
    expect(nextStep(task)).toBe("done");
    const rows = (
      await readFile(join(repo, ".factory", "history.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    expect(rows).toHaveLength(1);
  });
});

describe("usageTotals", () => {
  const entry = (beat: string, section: string, text: string) =>
    ({ beat, section, text }) as never;
  it("counts the runtime's usage notes, never numbers in an agent's summary", () => {
    const task = {
      entries: [
        entry(
          "build",
          "timeline",
          "build started · skills spine only · budget 12 steps / 60k ctx · 3 repo file(s) in context · 1200 tokens",
        ),
        entry(
          "build",
          "timeline",
          "build done · commit abcdef123456 · 2 file(s) this round · fixed it · 999999 tokens · $99.00",
        ),
        entry(
          "build",
          "timeline",
          "build done · commit abcdef123456 · 1 file(s) this round · 500 tokens · $0.25 · also · 7 tokens · $7.00",
        ),
        entry(
          "judge",
          "judge",
          "review round 1: approve; 0 blocking, 1 suggestion(s) (judge-model) · 8000 tokens · $0.12",
        ),
        entry("build", "plan", "1. log 5000 tokens · $5.00"),
      ],
    } as never;
    expect(usageTotals(task)).toEqual({ tokens: 9700, costUsd: 0.37 });
  });
});

describe("prTitle", () => {
  it("maps the card type to a conventional type and lowercases the subject", () => {
    const card = { title: "Redesign the settings page", type: "feature" };
    expect(prTitle(card as never)).toBe("feat: redesign the settings page");
    expect(prTitle({ title: "API keys rotate", type: "spike" } as never)).toBe(
      "chore: API keys rotate",
    );
  });
});
