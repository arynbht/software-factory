// The judge beat (§3.6, §8) for a task: tier 1 on a clean clone of base plus
// the task's branch, then tier 2 on the same change against the card. Never
// the worktree. A protected change, or blocking findings past the round limit,
// stop and ask a person; anything else blocking goes back to the agent. The
// round's record is written to `.factory/tasks/<id>/judge/round-<n>.json` and
// its hash sealed in the verdict entry, so ship can trust what it reads.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type AiClient,
  buildContext,
  createAiClient,
} from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";
import { parse } from "yaml";

import { loadIsolation } from "../agent/isolate.js";
import { AssemblySchema } from "../router/route.js";
import {
  JUDGE_VERDICT,
  judgeVerdicts,
  loadTask,
  nextStep,
  sha256,
  type Task,
  TaskError,
  TASKS_DIR,
} from "../task/tasks.js";
import { MAX_ROUNDS, type ReviewOutcome, reviewLocal } from "./review.js";
import { runTier1, type Tier1Options, type Tier1Result } from "./tier1.js";
import { JUDGE_DEFAULT_MODEL } from "./tier2.js";

/** What a judge round decided, as written to its record. */
export interface JudgeRecord {
  task: string;
  round: number;
  verdict: "passed" | "failed" | "needs a human";
  head: string;
  base: string;
  tier1: Pick<Tier1Result, "verdict" | "checks" | "protected" | "notes">;
  /** Absent when tier 1 didn't leave the decision to the review. */
  review?:
    | {
        verdict: ReviewOutcome["verdict"];
        body: string;
        model: string;
        blocking: ReviewOutcome["result"]["blocking"];
        suggestions: ReviewOutcome["result"]["suggestions"];
        acceptance: ReviewOutcome["result"]["acceptance"];
        unreviewed: string[];
        usage: ReviewOutcome["result"]["usage"];
      }
    | undefined;
}

export interface JudgeTaskOptions {
  by: string;
  now?: Date | undefined;
  /** The review's client (default: the subscription CLI, else the API key). */
  ai?: AiClient | undefined;
  model?: string | undefined;
  /** Tier 1 and tier 2, replaceable in tests. */
  tier1?: ((options: Tier1Options) => Promise<Tier1Result>) | undefined;
  review?: typeof reviewLocal | undefined;
  log?: ((line: string) => void) | undefined;
}

const recordPath = (repoPath: string, id: string, round: number) =>
  join(repoPath, TASKS_DIR, id, "judge", `round-${round}.json`);
const SEALED = /· record sha256 ([0-9a-f]{64})$/;
const BUILT = /^build (?:done|paused)[^·]*· commit ([0-9a-f]{12})/;

const oneLine = (s: string, n = 300) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * The latest judge round's record, checked against the hash in its verdict
 * entry. Null before the first verdict.
 */
export async function loadJudgeRecord(
  repoPath: string,
  task: Task,
): Promise<JudgeRecord | null> {
  const entry = [...task.entries]
    .reverse()
    .find(
      (e) =>
        e.beat === "judge" &&
        e.section === "timeline" &&
        JUDGE_VERDICT.test(e.text),
    );
  if (!entry) return null;
  const round = Number(JUDGE_VERDICT.exec(entry.text)?.[2]);
  const text = await readFile(
    recordPath(repoPath, task.card.id, round),
    "utf8",
  ).catch(() => null);
  if (text === null || sha256(text) !== SEALED.exec(entry.text)?.[1])
    throw new TaskError(
      `${TASKS_DIR}/${task.card.id}/judge/round-${round}.json doesn't match the record sealed in the ledger`,
    );
  return JSON.parse(text) as JudgeRecord;
}

/**
 * `factory task judge <id>`: judge the built, proved branch. Passed → ship.
 * Failed (rounds 1–2) → back to build with the findings. Needs a human (a
 * protected change, blocking findings in round 3, files the reviewer couldn't
 * see) → a stop-and-ask question; `--allow` ships it, `--deny` rebuilds.
 */
export async function judgeTask(
  repoPath: string,
  id: string,
  options: JudgeTaskOptions,
): Promise<{ task: Task; record: JudgeRecord }> {
  const log = options.log ?? (() => undefined);
  let task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not judging`);
  if (nextStep(task) !== "judge")
    throw new TaskError(`task ${id} isn't ready to judge: ${nextStep(task)}`);
  const isolation = await loadIsolation(repoPath, id);
  if (!isolation) throw new TaskError(`task ${id} has no worktree`);
  const assembly = AssemblySchema.parse(parse(task.assemblyText ?? ""));

  // Judge the commit the last build round made and the proof ran on, nothing
  // added to the branch since.
  const head = (
    await simpleGit(repoPath).revparse([`refs/heads/${isolation.branch}`])
  ).trim();
  const built = [...task.entries]
    .reverse()
    .map((e) =>
      e.beat === "build" && e.section === "timeline"
        ? BUILT.exec(e.text)?.[1]
        : undefined,
    )
    .find((c) => c !== undefined);
  if (!built || !head.startsWith(built))
    throw new TaskError(
      `${isolation.branch} is at ${head.slice(0, 12)}, but the last build round committed ${built ?? "nothing"}; build and prove again`,
    );

  const round = judgeVerdicts(task).length + 1;
  const by = `factory judge (for ${options.by})`;
  const append = (section: "timeline" | "judge" | "stop", text: string) =>
    task.ledger.append({ beat: "judge", section, text, by, at: options.now });

  log(`tier 1: ${assembly.checks.join(", ")}`);
  const tier1 = await (options.tier1 ?? runTier1)({
    repoPath,
    base: isolation.base,
    head,
    checks: assembly.checks,
    log,
  });
  const ran = tier1.checks.filter((c) => c.outcome !== "n/a");
  const count = (o: string) => ran.filter((c) => c.outcome === o).length;
  await append(
    "judge",
    `tier 1 round ${round}: ${tier1.verdict} · ${count("pass") + count("fixed")}/${ran.length} pass${count("pre-existing") ? ` · ${count("pre-existing")} pre-existing` : ""}${count("fail") ? ` · ${count("fail")} fail` : ""}`,
  );
  for (const c of tier1.checks.filter((c) => c.outcome === "fail"))
    await append("judge", `tier 1 fail: ${c.id} — ${oneLine(c.message)}`);
  for (const note of tier1.notes)
    await append("judge", `tier 1 fail: ${oneLine(note)}`);
  for (const p of tier1.protected)
    await append("judge", `protected: ${p.path} — ${p.detail}`);

  const record: JudgeRecord = {
    task: id,
    round,
    verdict: "passed",
    head,
    base: tier1.mergeBase,
    tier1: {
      verdict: tier1.verdict,
      checks: tier1.checks,
      protected: tier1.protected,
      notes: tier1.notes,
    },
  };
  let why = "";

  if (tier1.verdict === "needs-human") {
    // §8.2: a change to what judges it goes to a person; tier 2 doesn't run.
    record.verdict = "needs a human";
    why = `${tier1.protected.length} protected change(s)`;
  } else if (tier1.verdict === "fail") {
    // Fix the deterministic failures before paying for a review.
    record.verdict = round > MAX_ROUNDS ? "needs a human" : "failed";
    why = `tier 1 failed${round > MAX_ROUNDS ? ` in round ${round}` : ""}`;
  } else {
    const profile = await buildContext(repoPath)
      .profile()
      .catch(() => null);
    const outcome = await (options.review ?? reviewLocal)({
      repoPath,
      ai: options.ai ?? createAiClient({ timeoutMs: 900_000 }),
      model: options.model ?? profile?.ai?.judge_model ?? JUDGE_DEFAULT_MODEL,
      card: task.card,
      base: tier1.mergeBase,
      head,
      round,
      usageDate: (options.now ?? new Date()).toISOString().slice(0, 10),
      log,
    });
    const r = outcome.result;
    record.review = {
      verdict: outcome.verdict,
      body: outcome.body,
      model: r.model,
      blocking: r.blocking,
      suggestions: r.suggestions,
      acceptance: r.acceptance,
      unreviewed: r.unreviewed,
      usage: r.usage,
    };
    await append(
      "judge",
      `review round ${round}: ${outcome.verdict}; ${r.blocking.length} blocking, ${r.suggestions.length} suggestion(s) (${r.model}) · ${r.usage.tokens} tokens · $${r.usage.costUsd.toFixed(2)}`,
    );
    for (const f of r.blocking)
      await append(
        "judge",
        `blocking ${f.kind}${f.acceptance_id ? ` (${f.acceptance_id})` : ""} ${f.file ? `${f.file}${f.line ? `:${f.line}` : ""} ` : ""}— ${oneLine(f.title, 160)} · repro: ${oneLine(f.repro)}${f.fix ? ` · fix: ${oneLine(f.fix, 200)}` : ""}`,
      );
    for (const a of r.acceptance)
      await append(
        "judge",
        `acceptance ${a.id}: ${a.status}${a.note ? ` — ${oneLine(a.note, 200)}` : ""}`,
      );
    if (outcome.verdict === "approve") record.verdict = "passed";
    else if (outcome.verdict === "request-changes") {
      record.verdict = "failed";
      why = `${r.blocking.length} blocking`;
    } else {
      record.verdict = "needs a human";
      why =
        r.blocking.length > 0
          ? `${r.blocking.length} blocking after ${MAX_ROUNDS} rounds`
          : `the reviewer wasn't shown ${r.unreviewed.join(", ")}`;
    }
  }

  const text = `${JSON.stringify(record, null, 2)}\n`;
  await mkdir(join(repoPath, TASKS_DIR, id, "judge"), { recursive: true });
  await writeFile(recordPath(repoPath, id, round), text, "utf8");
  if (record.verdict === "needs a human")
    await append("stop", `asked: judge: ${why}; look at the change`);
  await append(
    "timeline",
    `judge ${record.verdict} · round ${round} · head ${head.slice(0, 12)}${why ? ` · ${why}` : ""} · record sha256 ${sha256(text)}`,
  );
  task = await loadTask(repoPath, id);
  return { task, record };
}
