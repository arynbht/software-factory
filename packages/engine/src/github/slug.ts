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
  // Both owner and repo are single path segments; a trailing /tree/... etc. is
  // not a bare remote and should not be mistaken for the repo name.
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo) return null;
  return { owner, repo };
}
