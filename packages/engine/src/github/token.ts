import { execFileSync } from "node:child_process";

import { installationToken, loadApp } from "./app.js";
import { resolveRepoSlug } from "../context.js";

/** Where a token came from: the factory's App acts as itself, the rest as a person. */
export type TokenSource = "explicit" | "env" | "app" | "gh";

/**
 * The token the factory acts on a repo with (spec v2.1 §14): an explicit one,
 * else `GITHUB_TOKEN`/`GH_TOKEN` (CI passes the App's installation token
 * there), else the factory's GitHub App when it's registered here and
 * installed on the repo's origin, else the `gh` login. With the App, reviews,
 * evidence and PRs come from the factory, not from whoever ran it.
 */
export async function githubToken(
  repoPath: string,
  explicit?: string,
  options: { fetch?: typeof fetch } = {},
): Promise<{ token: string; source: TokenSource } | null> {
  if (explicit) return { token: explicit, source: "explicit" };
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return { token: fromEnv, source: "env" };
  const app = await loadApp();
  const slug = app ? await resolveRepoSlug(repoPath) : null;
  if (app && slug) {
    const minted = await installationToken(app, slug, options).catch(
      () => null,
    );
    if (minted) return { token: minted.token, source: "app" };
  }
  const gh = resolveToken();
  return gh ? { token: gh, source: "gh" } : null;
}

/**
 * Resolve a GitHub token from, in order: an explicit value, the `GITHUB_TOKEN`
 * or `GH_TOKEN` environment variables, then the `gh` CLI's stored auth.
 *
 * The engine is source-agnostic about tokens: in CI this slot receives a GitHub
 * App installation token (ADR-0007); locally it is typically the `gh` login.
 */
export function resolveToken(explicit?: string): string | undefined {
  if (explicit) return explicit;

  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;

  try {
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}
