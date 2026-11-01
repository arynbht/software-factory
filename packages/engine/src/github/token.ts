import { execFileSync } from "node:child_process";

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
