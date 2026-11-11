import type { GitHubClient } from "../context.js";

export interface OpenPrParams {
  /** The branch the changes live on. */
  head: string;
  /** The branch to merge into (usually the default branch). */
  base: string;
  title: string;
  body: string;
  /** Open it as a draft (a reused PR keeps whatever state it has). */
  draft?: boolean;
}

export interface PrResult {
  number: number;
  url: string;
  /** True when an existing open factory PR was updated rather than created. */
  reused: boolean;
}

/**
 * Open a pull request for `head` → `base`, or — if an open PR already exists for
 * that head branch — update its title and body instead of opening a duplicate.
 * This is what lets repeated `factory fix --pr` runs keep refreshing one PR.
 */
export async function openOrReusePr(
  gh: GitHubClient,
  params: OpenPrParams,
): Promise<PrResult> {
  const { head, base, title, body, draft } = params;

  const { data: open } = await gh.octokit.rest.pulls.list({
    owner: gh.owner,
    repo: gh.repo,
    head: `${gh.owner}:${head}`,
    state: "open",
    per_page: 1,
  });

  const existing = open[0];
  if (existing) {
    await gh.octokit.rest.pulls.update({
      owner: gh.owner,
      repo: gh.repo,
      pull_number: existing.number,
      title,
      body,
    });
    return { number: existing.number, url: existing.html_url, reused: true };
  }

  const { data: created } = await gh.octokit.rest.pulls.create({
    owner: gh.owner,
    repo: gh.repo,
    head,
    base,
    title,
    body,
    ...(draft ? { draft: true } : {}),
  });
  return { number: created.number, url: created.html_url, reused: false };
}
