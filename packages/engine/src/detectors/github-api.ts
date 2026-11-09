import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext, GitHubClient } from "../context.js";
import { deepEqual } from "./path.js";
import type { DetectorResult } from "./types.js";

type GithubApiConfig = Extract<DetectorConfig, { type: "github-api" }>;
type GithubApiCheck = GithubApiConfig["check"];
type CheckFn = (
  gh: GitHubClient,
  config: GithubApiConfig,
) => Promise<DetectorResult>;

const pass = (message: string): DetectorResult => ({ status: "pass", message });
const fail = (message: string, remediation?: string): DetectorResult => ({
  status: "fail",
  message,
  remediation,
});
const skip = (message: string): DetectorResult => ({ status: "skip", message });

function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

interface RepoData {
  default_branch: string;
  private: boolean;
  visibility?: string | undefined;
  security_and_analysis?: {
    secret_scanning?: { status?: string };
    secret_scanning_push_protection?: { status?: string };
  } | null;
}

function getRepo(gh: GitHubClient): Promise<RepoData> {
  return gh.cached("repos.get", async () => {
    const { data } = await gh.octokit.rest.repos.get({
      owner: gh.owner,
      repo: gh.repo,
    });
    return data as RepoData;
  });
}

interface BranchRule {
  type: string;
}

interface ProtectionState {
  branch: string;
  /** Classic branch protection object, or null if none / not admin. */
  classic: Record<string, unknown> | null;
  /** Active repository-ruleset rules applying to the branch (needs only read). */
  rules: BranchRule[];
  /** True when classic protection could not be read (403: the token isn't admin). */
  classicUnreadable: boolean;
}

const ADMIN_NEEDED =
  "classic branch protection is unreadable with this token — needs an admin token (or protect the branch with a ruleset)";

/**
 * Resolve how the default branch is protected, covering both classic branch
 * protection (needs admin) and the newer repository rulesets (readable with just
 * read access). Shared and cached across the branch-oriented checks.
 */
function getProtectionState(gh: GitHubClient): Promise<ProtectionState> {
  return gh.cached("protection-state", async () => {
    const branch = (await getRepo(gh)).default_branch;

    let classic: Record<string, unknown> | null = null;
    let classicUnreadable = false;
    try {
      const { data } = await gh.octokit.rest.repos.getBranchProtection({
        owner: gh.owner,
        repo: gh.repo,
        branch,
      });
      classic = data as unknown as Record<string, unknown>;
    } catch (err) {
      // 404 = no classic protection; 403 = no admin. Either way, fall back to
      // rulesets. Any other error bubbles up to the skip translation.
      const status = statusOf(err);
      if (status !== 404 && status !== 403) throw err;
      classicUnreadable = status === 403;
    }

    // The rules endpoint needs only read access; let its errors bubble so a
    // genuine permission problem surfaces as a skip rather than a false "fail".
    const { data } = await gh.octokit.rest.repos.getBranchRules({
      owner: gh.owner,
      repo: gh.repo,
      branch,
    });
    const rules = (data as BranchRule[] | undefined) ?? [];

    return { branch, classic, rules, classicUnreadable };
  });
}

const checks: Partial<Record<GithubApiCheck, CheckFn>> = {
  "default-branch": async (gh, config) => {
    const repo = await getRepo(gh);
    if (
      config.equals !== undefined &&
      !deepEqual(repo.default_branch, config.equals)
    ) {
      return fail(`default branch is "${repo.default_branch}"`);
    }
    return pass(`default branch is "${repo.default_branch}"`);
  },

  visibility: async (gh, config) => {
    const repo = await getRepo(gh);
    const value = repo.visibility ?? (repo.private ? "private" : "public");
    if (config.equals !== undefined && !deepEqual(value, config.equals)) {
      return fail(`visibility is "${value}"`);
    }
    return pass(`visibility is "${value}"`);
  },

  "branch-protection": async (gh) => {
    const { branch, classic, rules, classicUnreadable } =
      await getProtectionState(gh);
    // A ruleset only counts as "protected" if it gates merges; a lone
    // non_fast_forward / deletion / creation rule is not meaningful protection.
    const meaningfulRule = rules.some(
      (r) => r.type === "pull_request" || r.type === "required_status_checks",
    );
    if (!classic && !meaningfulRule && classicUnreadable) {
      return skip(ADMIN_NEEDED);
    }
    return classic || meaningfulRule
      ? pass(`"${branch}" is protected${classic ? "" : " (ruleset)"}`)
      : fail(
          `"${branch}" has no branch protection`,
          `protect ${branch}: require a PR and status checks, block force-push`,
        );
  },

  "required-pull-request": async (gh) => {
    const { branch, classic, rules, classicUnreadable } =
      await getProtectionState(gh);
    const hasClassic = Boolean(classic?.["required_pull_request_reviews"]);
    const hasRule = rules.some((r) => r.type === "pull_request");
    if (!hasClassic && !hasRule && classicUnreadable) return skip(ADMIN_NEEDED);
    return hasClassic || hasRule
      ? pass(`pull request reviews required on "${branch}"`)
      : fail(`pull request reviews not required on "${branch}"`);
  },

  "required-status-checks": async (gh) => {
    const { branch, classic, rules, classicUnreadable } =
      await getProtectionState(gh);
    const hasClassic = Boolean(classic?.["required_status_checks"]);
    const hasRule = rules.some((r) => r.type === "required_status_checks");
    if (!hasClassic && !hasRule && classicUnreadable) return skip(ADMIN_NEEDED);
    return hasClassic || hasRule
      ? pass(`status checks required on "${branch}"`)
      : fail(`status checks not required on "${branch}"`);
  },

  "secret-scanning": async (gh) => {
    const repo = await getRepo(gh);
    if (!repo.security_and_analysis) {
      return skip(
        "cannot read security settings; needs a token with Administration: read",
      );
    }
    return repo.security_and_analysis.secret_scanning?.status === "enabled"
      ? pass("secret scanning enabled")
      : fail("secret scanning not enabled");
  },

  "secret-scanning-push-protection": async (gh) => {
    const repo = await getRepo(gh);
    if (!repo.security_and_analysis) {
      return skip(
        "cannot read security settings; needs a token with Administration: read",
      );
    }
    return repo.security_and_analysis.secret_scanning_push_protection
      ?.status === "enabled"
      ? pass("push protection enabled")
      : fail("secret scanning push protection not enabled");
  },

  "dependabot-security-updates": async (gh) => {
    try {
      const { data } = await gh.octokit.rest.repos.checkAutomatedSecurityFixes({
        owner: gh.owner,
        repo: gh.repo,
      });
      return data.enabled
        ? pass("Dependabot security updates enabled")
        : fail("Dependabot security updates disabled");
    } catch (err) {
      if (statusOf(err) === 404)
        return fail("Dependabot security updates disabled");
      throw err;
    }
  },

  "vulnerability-alerts": async (gh) => {
    try {
      await gh.octokit.rest.repos.checkVulnerabilityAlerts({
        owner: gh.owner,
        repo: gh.repo,
      });
      return pass("vulnerability alerts enabled");
    } catch (err) {
      if (statusOf(err) === 404) return fail("vulnerability alerts disabled");
      throw err;
    }
  },

  "actions-permissions": async (gh) => {
    const { data } =
      await gh.octokit.rest.actions.getGithubActionsPermissionsRepository({
        owner: gh.owner,
        repo: gh.repo,
      });
    return data.enabled
      ? pass(`Actions permission: ${data.allowed_actions ?? "enabled"}`)
      : fail("Actions are disabled for this repository");
  },
};

/** Queries a named repository check via the GitHub API. */
export async function githubApi(
  ctx: AuditContext,
  config: GithubApiConfig,
): Promise<DetectorResult> {
  const gh = await ctx.github();
  if (!gh) {
    return skip(
      "no GitHub token or repository slug; set GITHUB_TOKEN to run API checks",
    );
  }

  const check = checks[config.check];
  if (!check) {
    return skip(`github-api check "${config.check}" is not implemented yet`);
  }

  try {
    return await check(gh, config);
  } catch (err) {
    const status = statusOf(err);
    if (status === 401 || status === 403) {
      return skip(
        `insufficient permission for "${config.check}" (HTTP ${status}); use a GitHub App installation token with the required scope`,
      );
    }
    if (status === 404) {
      return skip(
        `"${config.check}": repository or resource not found (HTTP 404)`,
      );
    }
    return skip(
      `github-api "${config.check}" failed: ${(err as Error).message}`,
    );
  }
}
