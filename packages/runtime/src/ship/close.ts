// The close beat (§3.8): once a person has merged or closed the PR (or given
// up on the task), record the outcome with its duration, tokens and cost,
// remove the worktree, append a row to `.factory/history.jsonl`, and seal the
// ledger so nothing is written to it again.
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildContext } from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";
import { parse } from "yaml";

import { loadIsolation } from "../agent/isolate.js";
import { AssemblySchema } from "../router/route.js";
import { isSeal, SEAL_TEXT } from "../task/ledger.js";
import {
  judgeVerdicts,
  loadTask,
  type Task,
  TaskError,
} from "../task/tasks.js";

export interface PrState {
  state: "open" | "closed";
  merged: boolean;
  mergedBy?: string | undefined;
  mergedAt?: string | undefined;
}

export interface CloseOptions {
  by: string;
  now?: Date | undefined;
  /** Close without a merged PR, saying why. */
  abandon?: string | undefined;
  /** The PR's state (default: asked of the repo's GitHub). */
  prState?: ((pr: number) => Promise<PrState>) | undefined;
}

/** A task's row in `.factory/history.jsonl` (posture snapshots share the file). */
export interface TaskHistoryRow {
  kind: "task";
  date: string;
  task: string;
  type: string;
  outcome: "merged" | "closed" | "abandoned";
  pr: number | null;
  sectors: string[];
  skills: string[];
  minutes: number;
  tokens: number;
  cost_usd: number;
  build_rounds: number;
  judge_rounds: number;
}

const SHIPPED = /^draft PR (?:opened|updated): #(\d+)/;
/**
 * Where each entry carries its usage note, anchored on the runtime's own text
 * so an agent's summary (quoted after the note) can't add to the totals.
 */
const USAGE = String.raw`((?: · \d+ tokens)?(?: · \$\d+\.\d+)?)`;
const USAGE_AT = [
  new RegExp(
    String.raw`^build started · .* repo file\(s\) in context${USAGE}$`,
  ),
  new RegExp(
    String.raw`^build paused: \d+ thing\(s\) to ask about · commit [0-9a-f]+${USAGE}$`,
  ),
  new RegExp(
    String.raw`^build done · commit [0-9a-f]+ · \d+ file\(s\) this round${USAGE}`,
  ),
  new RegExp(String.raw`^review round \d+: [a-z-]+; .*\)${USAGE}$`),
];

/** Tokens and cost the ledger recorded for the agent and the judge. */
export function usageTotals(task: Task): { tokens: number; costUsd: number } {
  let tokens = 0;
  let costUsd = 0;
  for (const e of task.entries) {
    if (e.beat !== "build" && e.beat !== "judge") continue;
    const note = USAGE_AT.map((r) => r.exec(e.text)?.[1]).find(Boolean);
    if (!note) continue;
    tokens += Number(/ (\d+) tokens/.exec(note)?.[1] ?? 0);
    costUsd += Number(/\$(\d+\.\d+)/.exec(note)?.[1] ?? 0);
  }
  return { tokens, costUsd };
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0
    ? `${h}h${String(minutes % 60).padStart(2, "0")}m`
    : `${minutes}m`;
}

const kTokens = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k tokens` : `${n} tokens`;

async function githubPrState(repoPath: string, pr: number): Promise<PrState> {
  const gh = await buildContext(repoPath).github();
  if (!gh)
    throw new TaskError(
      "closing needs to see the PR: a GitHub token (GITHUB_TOKEN or `gh auth login`) and an origin remote",
    );
  const { data } = await gh.octokit.rest.pulls.get({
    owner: gh.owner,
    repo: gh.repo,
    pull_number: pr,
  });
  return {
    state: data.state === "open" ? "open" : "closed",
    merged: data.merged,
    mergedBy: data.merged_by?.login,
    mergedAt: data.merged_at ?? undefined,
  };
}

/**
 * `factory task close <id>`: after a person merges or closes the PR, or with
 * `abandon` at any point. Refuses while the PR is open: the factory never
 * merges, and a task isn't over until a person has decided.
 */
export async function closeTask(
  repoPath: string,
  id: string,
  options: CloseOptions,
): Promise<{ task: Task; row: TaskHistoryRow }> {
  const task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not closing`);
  const last = task.entries.at(-1);
  if (last && isSeal(last)) throw new TaskError(`task ${id} is already closed`);
  const now = options.now ?? new Date();
  const by = `factory runtime (for ${options.by})`;
  const append = (section: "timeline" | "outcome", text: string) =>
    task.ledger.append({ beat: "close", section, text, by, at: now });

  const shipped = [...task.entries]
    .reverse()
    .map((e) => (e.beat === "ship" ? SHIPPED.exec(e.text)?.[1] : undefined))
    .find((n) => n !== undefined);
  const pr = shipped ? Number(shipped) : null;

  // A close that stopped part-way already decided the outcome: finish it
  // without asking again or recording anything twice.
  const decided = task.entries.find(
    (e) => e.beat === "close" && e.section === "outcome",
  );
  let outcome: TaskHistoryRow["outcome"];
  let said = "";
  const abandon = options.abandon?.replace(/\s+/g, " ").trim();
  if (decided) {
    outcome = decided.text.startsWith("abandoned")
      ? "abandoned"
      : /^PR #\d+ merged/.test(decided.text)
        ? "merged"
        : "closed";
  } else if (abandon !== undefined) {
    outcome = "abandoned";
    said = `abandoned${abandon ? `: ${abandon}` : ""}${pr ? ` (PR #${pr} is left as it is)` : ""}`;
  } else {
    if (pr === null)
      throw new TaskError(
        `task ${id} has no PR yet; ship it, or close it with --abandon "<why>"`,
      );
    const state = await (
      options.prState ?? ((n: number) => githubPrState(repoPath, n))
    )(pr);
    if (state.state === "open" && !state.merged)
      throw new TaskError(
        `PR #${pr} is still open; a person merges or closes it, then close the task (or --abandon "<why>")`,
      );
    outcome = state.merged ? "merged" : "closed";
    said = state.merged
      ? `PR #${pr} merged${state.mergedBy ? ` by ${state.mergedBy}` : ""}${state.mergedAt ? ` ${state.mergedAt.slice(0, 16).replace("T", " ")}` : ""}`
      : `PR #${pr} closed without merging`;
  }

  const started = new Date(task.entries[0]?.at ?? now);
  const ms = new Date(decided?.at ?? now).getTime() - started.getTime();
  const usage = usageTotals(task);
  if (!decided)
    await append(
      "outcome",
      `${said} · ${formatDuration(ms)} · ${kTokens(usage.tokens)} · $${usage.costUsd.toFixed(2)}`,
    );

  // The worktree goes, unless its work isn't merged and a tracked file has
  // uncommitted edits: the runtime commits everything the agent writes, so
  // those are a person's, and they're kept. (Untracked files after the last
  // round are install and proof output.) The branch goes only when merged.
  const isolation = await loadIsolation(repoPath, id).catch(() => null);
  const present =
    isolation !== null &&
    (await access(isolation.worktree)
      .then(() => true)
      .catch(() => false));
  if (isolation && present) {
    const git = simpleGit(repoPath);
    const edited =
      outcome !== "merged" &&
      (
        await simpleGit(isolation.worktree)
          .raw(["status", "--porcelain", "--untracked-files=no"])
          .catch(() => "unknown")
      ).trim() !== "";
    const removed =
      !edited &&
      (await git
        .raw(["worktree", "remove", "--force", isolation.worktree])
        .then(() => true)
        .catch(() => false));
    const deleted =
      removed &&
      outcome === "merged" &&
      (await git
        .raw(["branch", "-D", isolation.branch])
        .then(() => true)
        .catch(() => false));
    await append(
      "timeline",
      `${removed ? "worktree removed" : `worktree ${isolation.worktree} kept: ${edited ? "it has uncommitted edits" : "it couldn't be removed"}; remove it by hand`} · branch ${isolation.branch} ${deleted ? "deleted" : "kept"}`,
    );
  }

  const assembly = task.assemblyText
    ? AssemblySchema.safeParse(parse(task.assemblyText))
    : null;
  const row: TaskHistoryRow = {
    kind: "task",
    date: now.toISOString().slice(0, 10),
    task: id,
    type: task.card.type,
    outcome,
    pr,
    sectors: assembly?.success ? assembly.data.sectors : [],
    skills: assembly?.success ? assembly.data.skills : [],
    minutes: Math.round(ms / 60_000),
    tokens: usage.tokens,
    cost_usd: Math.round(usage.costUsd * 100) / 100,
    build_rounds: task.entries.filter(
      (e) =>
        e.beat === "build" &&
        e.section === "timeline" &&
        /^build (done|paused)/.test(e.text),
    ).length,
    judge_rounds: judgeVerdicts(task).length,
  };
  const historyPath = join(repoPath, ".factory", "history.jsonl");
  const written = (await readFile(historyPath, "utf8").catch(() => ""))
    .split("\n")
    .some((line) => {
      try {
        const r = JSON.parse(line) as Partial<TaskHistoryRow>;
        return r.kind === "task" && r.task === id;
      } catch {
        return false;
      }
    });
  if (!written) {
    await mkdir(join(repoPath, ".factory"), { recursive: true });
    await appendFile(historyPath, `${JSON.stringify(row)}\n`, "utf8");
  }
  await append("timeline", `${SEAL_TEXT} · ${outcome}`);
  return { task: await loadTask(repoPath, id), row };
}
