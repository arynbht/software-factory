export interface RepoSlug {
  owner: string;
  repo: string;
}

/**
 * Parse an owner/repo slug from a git remote URL, handling both SSH
 * (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo`).
 * Returns null if the URL is not a recognisable GitHub remote.
 */
export function parseRepoSlug(url: string | undefined): RepoSlug | null {
  if (!url) return null;
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo) return null;
  return { owner, repo };
}
