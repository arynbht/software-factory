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

/** Branch-protection style checks share a fetch; 404 means "unprotected". */
async function getProtection(
  gh: GitHubClient,
): Promise<{ branch: string; protection: unknown | null }> {
  const repo = await getRepo(gh);
  try {
    const { data } = await gh.octokit.rest.repos.getBranchProtection({
      owner: gh.owner,
      repo: gh.repo,
      branch: repo.default_branch,
    });
    return { branch: repo.default_branch, protection: data };
  } catch (err) {
    if (statusOf(err) === 404) {
      return { branch: repo.default_branch, protection: null };
    }
    throw err;
  }
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
    const { branch, protection } = await getProtection(gh);
    return protection
      ? pass(`"${branch}" is protected`)
      : fail(
          `"${branch}" has no branch protection`,
          `protect ${branch}: require a PR and status checks, block force-push`,
        );
  },

  "required-pull-request": async (gh) => {
    const { branch, protection } = await getProtection(gh);
    if (!protection) return fail(`"${branch}" has no branch protection`);
    const has = (protection as { required_pull_request_reviews?: unknown })
      .required_pull_request_reviews;
    return has
      ? pass(`pull request reviews required on "${branch}"`)
      : fail(`pull request reviews not required on "${branch}"`);
  },

  "required-status-checks": async (gh) => {
    const { branch, protection } = await getProtection(gh);
    if (!protection) return fail(`"${branch}" has no branch protection`);
    const has = (protection as { required_status_checks?: unknown })
      .required_status_checks;
    return has
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
