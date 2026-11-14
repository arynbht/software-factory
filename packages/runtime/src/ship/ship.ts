// The ship beat (§3.7): push the task's branch and open a draft PR whose body
// is generated from the card, the ledger, the proof and the judge's record —
// summary, acceptance criteria with the judge's verdict on each, proof, files
// changed, skills, model and iterations. The factory never merges.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildContext,
  type GitHubClient,
  githubToken,
  openOrReusePr,
  type OpenPrParams,
  type PrResult,
  pushBranch,
} from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";
import { parse } from "yaml";

import { type Isolation, loadIsolation } from "../agent/isolate.js";
import { type JudgeRecord, loadJudgeRecord } from "../judge/task-judge.js";
import { parseNameStatus } from "../judge/tier1.js";
import type { ProofRecord } from "../proof/prove.js";
import { type Assembly, AssemblySchema } from "../router/route.js";
import type { Card } from "../task/card.js";
import {
  judgeVerdicts,
  loadTask,
  nextStep,
  type Task,
  TaskError,
  TASKS_DIR,
} from "../task/tasks.js";

/** Marks a PR body as the factory's, with the task it came from. */
export const PR_MARKER = "<!-- factory-task";

/** Card types → conventional commit types (the PR title is the squash subject). */
const COMMIT_TYPE: Record<Card["type"], string> = {
  feature: "feat",
  fix: "fix",
  chore: "chore",
  refactor: "refactor",
  spike: "chore",
};

export function prTitle(card: Card): string {
  const title = card.title.trim();
  // commitlint wants the subject to start lowercase; leave acronyms alone.
  const subject = /^[A-Z][a-z]/.test(title)
    ? `${title[0]!.toLowerCase()}${title.slice(1)}`
    : title;
  return `${COMMIT_TYPE[card.type]}: ${subject}`;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export interface PrBodyInput {
  task: Task;
  assembly: Assembly;
  judge: JudgeRecord;
  proof: ProofRecord | null;
  /** `git diff --name-status` from the merge-base to the judged head. */
  files: { status: string; path: string }[];
}

/** The draft PR's body, in the order a reviewer reads it. */
export function renderPrBody(input: PrBodyInput): string {
  const { task, assembly, judge, proof, files } = input;
  const { card } = task;
  const verdicts = new Map(
    (judge.review?.acceptance ?? []).map((a) => [a.id, a]),
  );
  const out: string[] = [
    `${PR_MARKER} ${card.id} -->`,
    "## Summary",
    "",
    card.description.trim(),
    "",
    `Task ${card.id} · ${card.type} · risk ${card.risk}${card.source !== "prompt" ? ` · ${card.source}` : ""}`,
  ];
  if (card.out_of_scope.length > 0)
    out.push("", `Out of scope: ${card.out_of_scope.join("; ")}.`);

  out.push(
    "",
    "## Acceptance criteria",
    "",
    "| ID | Criterion | Verified by | Judge |",
    "| -- | --------- | ----------- | ----- |",
    ...card.acceptance.map((a) => {
      const v = verdicts.get(a.id);
      const status = v
        ? `${v.status === "met" ? "✅" : v.status === "unmet" ? "❌" : "❔"} ${v.status}${v.note ? ` — ${cell(v.note)}` : ""}`
        : "not reviewed";
      return `| ${a.id} | ${cell(a.text)} | ${a.verify} | ${status} |`;
    }),
  );

  out.push("", "## Proof", "");
  if (!proof) out.push("_No proof record found._");
  else {
    out.push(
      `${proof.passed ? "Passed" : "Failed"} · ${proof.kind}`,
      "",
      ...proof.lines.map((l) => `- ${l}`),
    );
    const shots = proof.shots ?? [];
    const pairs = [
      ...new Set(shots.map((s) => `${s.page}\u0000${s.breakpoint}`)),
    ].map((k) => k.split("\u0000") as [string, string]);
    const img = (side: "before" | "after", page: string, bp: string) => {
      const s = shots.find(
        (x) => x.side === side && x.page === page && x.breakpoint === bp,
      );
      return s?.url ? `![${side} ${page} ${bp}](${s.url})` : "—";
    };
    if (shots.some((s) => s.url)) {
      out.push(
        "",
        "| Page | Size | Before | After |",
        "| ---- | ---- | ------ | ----- |",
        ...pairs.map(
          ([page, bp]) =>
            `| \`${page}\` | ${bp} | ${img("before", page, bp)} | ${img("after", page, bp)} |`,
        ),
      );
    }
  }

  const t1 = judge.tier1;
  const ran = t1.checks.filter((c) => c.outcome !== "n/a");
  out.push(
    "",
    "## Judge",
    "",
    `Round ${judge.round} · ${judge.verdict} · head \`${judge.head.slice(0, 12)}\``,
    "",
    `- Tier 1: ${ran.filter((c) => c.outcome === "pass" || c.outcome === "fixed").length}/${ran.length} checks pass${
      ran.some((c) => c.outcome === "pre-existing")
        ? ` (${ran
            .filter((c) => c.outcome === "pre-existing")
            .map((c) => c.id)
            .join(", ")} red on base too)`
        : ""
    }`,
    ...t1.protected.map(
      (p) =>
        `- Protected change, approved by a person: \`${p.path}\` — ${p.detail}`,
    ),
  );
  if (judge.review) {
    const r = judge.review;
    out.push(
      `- Tier 2: ${r.verdict} · ${r.blocking.length} blocking · ${r.suggestions.length} suggestion(s) · ${r.model}`,
    );
    if (r.blocking.length > 0) {
      out.push("", "Blocking findings a person accepted:");
      for (const f of r.blocking)
        out.push(
          `- **${f.kind}: ${f.title}** ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`` : ""} — ${f.repro}`,
        );
    }
    if (r.suggestions.length > 0) {
      out.push(
        "",
        `<details><summary>${r.suggestions.length} suggestion(s), non-blocking</summary>`,
        "",
        ...r.suggestions.map(
          (f) =>
            `- ${f.title}${f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : ""}${f.fix ? ` — ${f.fix}` : ""}`,
        ),
        "",
        "</details>",
      );
    }
  }

  out.push(
    "",
    "## Files changed",
    "",
    ...(files.length > 0
      ? files.map((f) => `- \`${f.status}\` ${f.path}`)
      : ["_none_"]),
  );

  const e = task.entries;
  const builds = e.filter(
    (x) =>
      x.beat === "build" &&
      x.section === "timeline" &&
      /^build (done|paused)/.test(x.text),
  ).length;
  const stops = e.filter(
    (x) => x.section === "stop" && x.text.startsWith("asked: "),
  ).length;
  out.push(
    "",
    "## Run",
    "",
    `- Sectors: ${assembly.sectors.join(", ") || "none"} · proof: ${assembly.proof}`,
    `- Skills: ${[...assembly.skills, ...assembly.spine].join(", ") || "spine only"}${assembly.gaps.length > 0 ? ` · no skill for ${assembly.gaps.join(", ")}` : ""}`,
    `- Iterations: ${builds} build round(s) · ${judgeVerdicts(task).length} judge round(s) · ${stops} stop-and-ask question(s)`,
    ...(judge.review ? [`- Judge model: ${judge.review.model}`] : []),
    "",
    `_Written by the factory from \`${TASKS_DIR}/${card.id}/\`. Claude builds, the judge checks, a person merges._`,
  );
  return `${out.join("\n")}\n`;
}

/** Marks the judge's review on a factory PR, with the task and the head it judged. */
export const TASK_REVIEW_MARKER = "<!-- factory-task-review";

/**
 * The judge's verdict as one PR review (§10): the tier 2 review when it ran,
 * after a line on tier 1 and any protected change a person allowed.
 */
export function renderTaskReview(task: Task, judge: JudgeRecord): string {
  const ran = judge.tier1.checks.filter((c) => c.outcome !== "n/a");
  const pass = ran.filter(
    (c) => c.outcome === "pass" || c.outcome === "fixed",
  ).length;
  const out = [
    `${TASK_REVIEW_MARKER} ${task.card.id} head=${judge.head} -->`,
    `**Factory judge** · ${task.card.id} · round ${judge.round} · ${judge.verdict}`,
    "",
    `- Tier 1: ${pass}/${ran.length} checks pass`,
    ...judge.tier1.protected.map(
      (p) =>
        `- Protected change, approved by a person: \`${p.path}\` — ${p.detail}`,
    ),
  ];
  if (judge.review) out.push("", judge.review.body.trim());
  else out.push("- Tier 2: didn't run; a person decided this round");
  return `${out.join("\n")}\n`;
}

export interface PostReviewParams {
  pr: number;
  head: string;
  body: string;
  /** Labels the PR `factory:needs-human`, for the shell and the status issue. */
  needsHuman: boolean;
}

export interface ShipOptions {
  by: string;
  now?: Date | undefined;
  /** Push the branch (default: to origin, hooks off). */
  push?: ((isolation: Isolation) => Promise<void>) | undefined;
  /** Open or update the PR (default: the repo's GitHub via its token). */
  openPr?: ((params: OpenPrParams) => Promise<PrResult>) | undefined;
  /**
   * Post the judge's review (default: as the App, or whoever the token is).
   * Returns its URL, or null when this head already has one.
   */
  postReview?:
    ((params: PostReviewParams) => Promise<string | null>) | undefined;
}

export const NEEDS_HUMAN_LABEL = "factory:needs-human";

/** Post the judge's review once per head; GitHub won't let the App approve its own PR, so it's a comment. */
async function postTaskReview(
  gh: GitHubClient,
  params: PostReviewParams,
): Promise<string | null> {
  const { owner, repo, octokit } = gh;
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: params.pr,
  });
  const marker = params.body.split("\n")[0]!;
  if (reviews.some((r) => r.body?.startsWith(marker))) return null;
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: params.pr,
    commit_id: params.head,
    event: "COMMENT",
    body: params.body,
  });
  if (params.needsHuman)
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: params.pr,
      labels: [NEEDS_HUMAN_LABEL],
    });
  return data.html_url;
}

/** The PR's base branch, from the ref the worktree was cut from. */
function baseBranch(isolation: Isolation): string {
  const ref = isolation.baseRef.replace(/^origin\//, "");
  if (ref === "HEAD" || /^[0-9a-f]{7,40}$/.test(ref))
    throw new TaskError(
      `${isolation.task} was cut from ${isolation.baseRef}, not a branch on origin; there's no branch to open a PR against`,
    );
  return ref;
}

/**
 * `factory task ship <id>`: push the judged branch and open (or refresh) its
 * draft PR. Refuses when the branch moved after the judge's verdict.
 */
export async function shipTask(
  repoPath: string,
  id: string,
  options: ShipOptions,
): Promise<{ task: Task; pr: PrResult }> {
  const task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not shipping`);
  if (nextStep(task) !== "ship")
    throw new TaskError(`task ${id} isn't ready to ship: ${nextStep(task)}`);
  const isolation = await loadIsolation(repoPath, id);
  if (!isolation) throw new TaskError(`task ${id} has no worktree`);
  const judge = await loadJudgeRecord(repoPath, task);
  if (!judge) throw new TaskError(`task ${id} hasn't been judged`);
  const git = simpleGit(repoPath);
  const head = (await git.revparse([`refs/heads/${isolation.branch}`])).trim();
  if (head !== judge.head)
    throw new TaskError(
      `${isolation.branch} moved after the judge's verdict (${judge.head.slice(0, 12)} → ${head.slice(0, 12)}); judge it again`,
    );

  const assembly = AssemblySchema.parse(parse(task.assemblyText ?? ""));
  const proof = await readFile(
    join(repoPath, TASKS_DIR, id, "proof", "proof.json"),
    "utf8",
  )
    .then((t) => JSON.parse(t) as ProofRecord)
    .catch(() => null);
  const files = parseNameStatus(
    await git.raw(["diff", "--name-status", "-M", judge.base, judge.head]),
  ).map((f) => ({ status: f.status, path: f.path }));
  const body = renderPrBody({ task, assembly, judge, proof, files });
  const base = baseBranch(isolation);

  let openPr = options.openPr;
  let postReview = options.postReview;
  if (!openPr || !postReview) {
    const auth = await githubToken(repoPath);
    const gh = auth
      ? await buildContext(repoPath, { token: auth.token }).github()
      : null;
    if (!gh)
      throw new TaskError(
        "shipping needs GitHub: the factory's App installed on the repo, GITHUB_TOKEN or `gh auth login`, and an origin remote on GitHub",
      );
    openPr ??= (params) => openOrReusePr(gh, params);
    postReview ??= (params) => postTaskReview(gh, params);
  }
  await (
    options.push ??
    ((iso: Isolation) => pushBranch(iso.worktree, "origin", iso.branch))
  )(isolation);
  const pr = await openPr({
    head: isolation.branch,
    base,
    title: prTitle(task.card),
    body,
    draft: true,
  });
  // Before the ship entry: if posting fails, shipping again reuses the PR and
  // posts it then.
  const reviewUrl = await postReview({
    pr: pr.number,
    head,
    body: renderTaskReview(task, judge),
    needsHuman: judge.verdict === "needs a human",
  });
  if (reviewUrl)
    await task.ledger.append({
      beat: "ship",
      section: "judge",
      text: `judge review posted: ${reviewUrl}`,
      by: `factory runtime (for ${options.by})`,
      at: options.now,
    });
  await task.ledger.append({
    beat: "ship",
    section: "timeline",
    text: `${pr.reused ? "draft PR updated" : "draft PR opened"}: #${pr.number} ${pr.url} · ${isolation.branch} at ${head.slice(0, 12)} → ${base}`,
    by: `factory runtime (for ${options.by})`,
    at: options.now,
  });
  return { task: await loadTask(repoPath, id), pr };
}
