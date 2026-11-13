import { resolve } from "node:path";

import {
  AiError,
  buildContext,
  createAiClient,
  githubToken,
} from "@arynbht/factory-engine";
import {
  JUDGE_DEFAULT_MODEL,
  loadTask,
  type ReviewOutcome,
  reviewLocal,
  reviewPullRequest,
  whoami,
} from "@arynbht/factory-runtime";

import { today } from "../dates.js";

export interface ReviewFlags {
  pr?: string;
  base?: string;
  head?: string;
  task?: string;
  model?: string;
  token?: string;
  dryRun?: boolean;
  json?: boolean;
}

const EXIT = { approve: 0, "request-changes": 1, "needs-human": 2 } as const;

/**
 * `factory review`: judge tier 2. With `--pr <n>`, reviews that pull request and
 * posts one review (unless `--dry-run`); otherwise reviews the local change
 * from `--base` (default origin/main) to `--head` and prints it.
 */
export async function runReview(
  path: string,
  flags: ReviewFlags,
): Promise<number> {
  const repo = resolve(path);
  const log = flags.json
    ? undefined
    : (line: string) => process.stderr.write(`· ${line}\n`);

  let card;
  let task;
  if (flags.task) {
    task = await loadTask(repo, flags.task).catch((err: Error) => {
      console.error(`factory review: ${err.message}`);
      return null;
    });
    if (!task) return 1;
    if (task.problems.length > 0 || !task.confirmed) {
      console.error(
        `factory review: task ${flags.task} ${task.problems.length > 0 ? "fails verification" : "isn't confirmed yet"}; not reviewing against it.`,
      );
      return 1;
    }
    card = task.card;
  }

  const profile = await buildContext(repo)
    .profile()
    .catch(() => null);
  const model = flags.model ?? profile?.ai?.judge_model ?? JUDGE_DEFAULT_MODEL;
  const common = {
    repoPath: repo,
    ai: createAiClient({ timeoutMs: 600_000 }),
    model,
    card,
    usageDate: today(),
    log,
  };

  let outcome: ReviewOutcome;
  try {
    if (flags.pr) {
      if (!/^[1-9]\d*$/.test(flags.pr)) {
        console.error(
          `factory review: --pr takes a PR number, not "${flags.pr}".`,
        );
        return 1;
      }
      const token = (await githubToken(repo, flags.token))?.token;
      if (!token) {
        console.error(
          "factory review: --pr needs GitHub: the factory's App installed on the repo, GITHUB_TOKEN, or `gh auth login`.",
        );
        return 1;
      }
      outcome = await reviewPullRequest({
        ...common,
        pr: Number(flags.pr),
        token,
        post: !flags.dryRun,
      });
    } else {
      outcome = await reviewLocal({
        ...common,
        base: flags.base ?? "origin/main",
        head: flags.head,
      });
    }
  } catch (err) {
    console.error(
      `factory review: ${err instanceof AiError ? err.message : (err as Error).message}`,
    );
    return 1;
  }

  // A dry run posted nothing, so it isn't a round.
  if (task && !(flags.pr && flags.dryRun)) {
    const r = outcome.result;
    await task.ledger.append({
      beat: "judge",
      section: "judge",
      text: `review round ${outcome.round}: ${outcome.verdict}; ${r.blocking.length} blocking, ${r.suggestions.length} suggestion(s) (${r.model})`,
      by: `factory judge (for ${await whoami(repo)})`,
    });
  }

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ...outcome, result: { ...outcome.result, packed: { ...outcome.result.packed, lines: undefined } } }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`${outcome.body}\n`);
    if (outcome.posted) {
      process.stdout.write(
        `\nposted (${outcome.posted.event}): ${outcome.posted.url}\n`,
      );
    }
  }
  return EXIT[outcome.verdict];
}
