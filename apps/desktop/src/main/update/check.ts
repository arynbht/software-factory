// Manual update check (ADR-0010, private-repo path). electron-updater can't read a
// private repo's releases, so we query the GitHub Releases API with the user's
// token and report whether a newer release exists. Pure: `fetch` is injectable so
// the version comparison is unit-tested without the network.
import type { UpdateInfo } from "../../shared/ipc";

const GITHUB_API = "https://api.github.com";

export interface UpdateCheckDeps {
  fetch: typeof globalThis.fetch;
  /** The running app version (e.g. app.getVersion()). */
  currentVersion: string;
  /** owner/repo of the release repo. */
  repo: string;
  /** GitHub token; private release repos require it. */
  token: string | undefined;
}

interface Release {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/** Strip a leading `v`/`name@` and split into numeric segments for comparison. */
function parseVersion(raw: string): number[] {
  const cleaned = raw
    .trim()
    .replace(/^.*@/, "") // drop a `pkg@` prefix if the tag carries one
    .replace(/^v/i, "")
    .split("-")[0]; // ignore a prerelease suffix for ordering
  return (cleaned ?? "")
    .split(".")
    .map((n) => Number.parseInt(n, 10))
    .map((n) => (Number.isNaN(n) ? 0 : n));
}

/** True when `latest` is strictly newer than `current` (semver-ish). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(
  deps: UpdateCheckDeps,
): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    currentVersion: deps.currentVersion,
    latestVersion: null,
    updateAvailable: false,
    url: null,
    publishedAt: null,
  };

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "factory-desktop",
  };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  const res = await deps.fetch(
    `${GITHUB_API}/repos/${deps.repo}/releases/latest`,
    { headers },
  );

  // No published (non-draft) release yet → nothing to update to, not an error.
  if (res.status === 404) return base;
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "update check failed: sign in to GitHub to read releases"
        : `update check failed (${res.status})`,
    );
  }

  const data = (await res.json()) as Release;
  if (data.draft === true) return base;
  const tag = typeof data.tag_name === "string" ? data.tag_name : null;
  if (!tag) return base;

  return {
    currentVersion: deps.currentVersion,
    latestVersion: tag,
    updateAvailable: isNewer(tag, deps.currentVersion),
    url: typeof data.html_url === "string" ? data.html_url : null,
    publishedAt:
      typeof data.published_at === "string" ? data.published_at : null,
  };
}
