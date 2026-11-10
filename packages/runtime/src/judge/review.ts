// `factory review`: judge tier 2 on a local branch or a GitHub pull request,
// with the two-round limit and posting as a single PR review.
import {
  type AiClient,
  Octokit,
  QUIET_LOG,
  resolveRepoSlug,
} from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";

import type { Card } from "../task/card.js";
import {
  type Finding,
  renderReview,
  REVIEW_MARKER,
  runTier2,
  type Tier2Result,
} from "./tier2.js";

/** After this many rounds, remaining blocking findings go to a person. */
export const MAX_ROUNDS = 2;

export type ReviewVerdict = "approve" | "request-changes" | "needs-human";

export interface ReviewOutcome {
  verdict: ReviewVerdict;
  round: number;
  result: Tier2Result;
  body: string;
  /** Set when the review was posted to a pull request. */
  posted?: { url: string; event: string } | undefined;
}

export interface ReviewOptions {
  repoPath: string;
  ai: AiClient;
  model?: string | undefined;
  card?: Card | undefined;
  usageDate?: string | undefined;
  log?: ((line: string) => void) | undefined;
}

/** The verdict for a round: blocking findings past the round limit need a person. */
export function roundVerdict(
  result: Tier2Result,
  round: number,
): ReviewVerdict {
  if (result.verdict === "approve") return "approve";
  return round > MAX_ROUNDS ? "needs-human" : "request-changes";
}

/** Review a local change: the diff from merge-base(base, head) to head. */
export async function reviewLocal(
  options: ReviewOptions & {
    base: string;
    head?: string | undefined;
    round?: number;
  },
): Promise<ReviewOutcome> {
  const git = simpleGit(options.repoPath);
  const head = (await git.revparse([options.head ?? "HEAD"])).trim();
  const base = (await git.raw(["merge-base", options.base, head])).trim();
  const result = await runTier2({ ...options, base, head });
  const round = options.round ?? 1;
  const verdict = roundVerdict(result, round);
  return { verdict, round, result, body: renderReview(result, round, verdict) };
}

/**
 * Review a pull request: fetch its head, diff it against its base, count the
 * judge's earlier rounds on it, and (with `post`) leave one review — inline
 * comments for blocking findings on lines in the diff, suggestions in the body.
 */
export async function reviewPullRequest(
  options: ReviewOptions & { pr: number; token: string; post: boolean },
): Promise<ReviewOutcome> {
  const slug = await resolveRepoSlug(options.repoPath);
  if (!slug)
    throw new Error("can't tell which GitHub repo this is (no origin remote)");
  const octokit = new Octokit({ auth: options.token, log: QUIET_LOG });
  const { owner, repo } = slug;
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: options.pr,
  });

  const git = simpleGit(options.repoPath);
  await git.raw([
    "fetch",
    "--quiet",
    "origin",
    `+pull/${options.pr}/head:refs/factory/pr-${options.pr}`,
  ]);
  await git.raw(["fetch", "--quiet", "origin", pr.base.ref]);
  const head = (await git.revparse([`refs/factory/pr-${options.pr}`])).trim();
  const base = (
    await git.raw(["merge-base", `origin/${pr.base.ref}`, head])
  ).trim();

  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: options.pr,
  });
  const round =
    reviews.filter((r) => r.body?.includes(REVIEW_MARKER)).length + 1;

  const result = await runTier2({ ...options, base, head });
  const verdict = roundVerdict(result, round);
  const body = renderReview(result, round, verdict);
  const outcome: ReviewOutcome = { verdict, round, result, body };
  if (!options.post) return outcome;

  const comments = result.blocking
    .filter((f): f is Finding & { line: number } =>
      Boolean(f.line && result.packed.lines.get(f.file)?.has(f.line)),
    )
    .map((f) => ({
      path: f.file,
      line: f.line,
      side: "RIGHT" as const,
      body: `**${f.kind}: ${f.title}**\n\n${f.detail}\n\n**Repro:** ${f.repro}${f.fix ? `\n\n**Fix:** ${f.fix}` : ""}`,
    }));
  const event =
    verdict === "approve"
      ? "APPROVE"
      : verdict === "request-changes"
        ? "REQUEST_CHANGES"
        : "COMMENT";

  const attempts: {
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    comments: typeof comments;
  }[] = [
    { event, comments },
    // An inline comment on a line GitHub won't accept: keep the verdict, move
    // the findings into the body.
    { event, comments: [] },
    // GitHub refuses approve/request-changes on your own PR: say it in a comment.
    { event: "COMMENT", comments },
    { event: "COMMENT", comments: [] },
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const { data } = await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: options.pr,
        commit_id: head,
        event: attempt.event,
        body,
        comments: attempt.comments,
      });
      outcome.posted = { url: data.html_url, event: attempt.event };
      return outcome;
    } catch (err) {
      lastError = err;
      if ((err as { status?: number }).status !== 422) throw err;
    }
  }
  throw lastError;
}
