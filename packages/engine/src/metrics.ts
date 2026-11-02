// DORA metrics computed from the GitHub API with no extra services. Each metric
// documents its proxy (the API has no first-class "deployment" or "incident"), and
// returns null when there isn't enough data to compute it honestly.

import type { GitHubClient } from "./context.js";
import { DAY_MS } from "./dates.js";

export interface Metrics {
  windowDays: number;
  /** Releases per week in the window (proxy: a GitHub Release is a deployment). */
  deploymentFrequencyPerWeek: number;
  /** Median hours from PR open to merge (proxy: merge = change delivered). */
  leadTimeHoursMedian: number | null;
  /** Fraction of merged PRs that are reverts/hotfixes (proxy for failures). */
  changeFailureRate: number | null;
  /** Median hours an `incident`-labeled issue stays open (open → close). */
  timeToRestoreHoursMedian: number | null;
  /** Human-readable note of what each number is a proxy for. */
  assumptions: string[];
}

export interface MetricsOptions {
  /** The run's "now" (injected; no wall-clock reads in the engine). */
  now: Date;
  /** How far back to look (default 90 days). */
  windowDays?: number | undefined;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

const HOUR_MS = 60 * 60 * 1000;

/** Compute the four DORA keys for a repo over a trailing window. */
export async function computeMetrics(
  gh: GitHubClient,
  options: MetricsOptions,
): Promise<Metrics> {
  const windowDays = options.windowDays ?? 90;
  const since = new Date(options.now.getTime() - windowDays * DAY_MS);
  const sinceMs = since.getTime();
  const { octokit, owner, repo } = gh;

  // Deployment frequency — published releases in the window.
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });
  const deploys = releases.filter(
    (r) => r.published_at && Date.parse(r.published_at) >= sinceMs,
  ).length;
  const deploymentFrequencyPerWeek = deploys / (windowDays / 7);

  // Lead time + change failure rate — merged PRs in the window.
  const pulls = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: "closed",
    per_page: 100,
    sort: "updated",
    direction: "desc",
  });
  const merged = pulls.filter(
    (p) => p.merged_at && Date.parse(p.merged_at) >= sinceMs,
  );
  const leadTimes = merged.map(
    (p) => (Date.parse(p.merged_at!) - Date.parse(p.created_at)) / HOUR_MS,
  );
  const failures = merged.filter((p) =>
    /\b(revert|hotfix|rollback)\b/i.test(
      `${p.title ?? ""} ${p.head?.ref ?? ""}`,
    ),
  ).length;
  const changeFailureRate = merged.length > 0 ? failures / merged.length : null;

  // Time to restore — `incident`-labeled issues closed in the window.
  const incidents = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "closed",
    labels: "incident",
    per_page: 100,
  });
  const restoreTimes = incidents
    .filter(
      (i) =>
        !i.pull_request && i.closed_at && Date.parse(i.closed_at) >= sinceMs,
    )
    .map(
      (i) => (Date.parse(i.closed_at!) - Date.parse(i.created_at)) / HOUR_MS,
    );

  return {
    windowDays,
    deploymentFrequencyPerWeek,
    leadTimeHoursMedian: median(leadTimes),
    changeFailureRate,
    timeToRestoreHoursMedian: median(restoreTimes),
    assumptions: [
      "Deployment = a published GitHub Release.",
      "Lead time = PR creation to merge (merge = change delivered).",
      "Change failure = merged PR whose title/branch says revert/hotfix/rollback.",
      "Time to restore = open-to-close of an issue labeled `incident`.",
    ],
  };
}
