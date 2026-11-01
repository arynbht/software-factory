import type { Octokit } from "@octokit/rest";

/** Hidden marker so we can find and update our own comment/issue idempotently. */
export const FACTORY_MARKER = "<!-- factory-audit -->";
export const STATUS_ISSUE_TITLE = "Factory status";

/** Create or update a single sticky PR comment identified by the marker. */
export async function upsertStickyComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const marked = `${FACTORY_MARKER}\n${body}`;
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find((c) => c.body?.includes(FACTORY_MARKER));
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: marked,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: marked,
    });
  }
}

/**
 * Maintain one pinned "Factory status" issue for scheduled runs: open/update it
 * while gates are red/amber, and close it once everything is green.
 */
export async function upsertStatusIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  body: string,
  allGreen: boolean,
): Promise<void> {
  const { data: issues } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const existing = issues.find(
    (i) => i.title === STATUS_ISSUE_TITLE && !i.pull_request,
  );
  const marked = `${FACTORY_MARKER}\n${body}`;

  if (allGreen) {
    if (existing) {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: existing.number,
        state: "closed",
        body: `${marked}\n\n_All gates are green._`,
      });
    }
    return;
  }

  if (existing) {
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      state: "open",
      body: marked,
    });
  } else {
    await octokit.rest.issues.create({
      owner,
      repo,
      title: STATUS_ISSUE_TITLE,
      body: marked,
    });
  }
}
