import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext, GitHubClient } from "../context.js";
import type { Change, Generator } from "./types.js";

type SettingAction = (gh: GitHubClient) => Promise<void>;

const PROTECTION_RULESET = "factory: protect default branch";

/** Create a repository ruleset protecting the default branch, if absent. */
async function ensureProtectionRuleset(gh: GitHubClient): Promise<void> {
  const { data: rulesets } = await gh.octokit.rest.repos.getRepoRulesets({
    owner: gh.owner,
    repo: gh.repo,
  });
  if (rulesets.some((r) => r.name === PROTECTION_RULESET)) return;

  await gh.octokit.rest.repos.createRepoRuleset({
    owner: gh.owner,
    repo: gh.repo,
    name: PROTECTION_RULESET,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      {
        type: "pull_request",
        parameters: {
          // Require at least one approving review: the `required-pull-request`
          // detector reports "PR reviews required" as satisfied, so the ruleset
          // must actually enforce a review rather than permit self-merge. A solo
          // maintainer who intends to self-merge waives the control instead.
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      { type: "non_fast_forward" },
    ],
  });
}

const settingActions: Record<string, SettingAction> = {
  "branch-protection": ensureProtectionRuleset,
  "required-pull-request": ensureProtectionRuleset,
  "secret-scanning-push-protection": async (gh) => {
    await gh.octokit.rest.repos.update({
      owner: gh.owner,
      repo: gh.repo,
      security_and_analysis: {
        secret_scanning_push_protection: { status: "enabled" },
      },
    });
  },
  "dependabot-security-updates": async (gh) => {
    await gh.octokit.rest.repos.enableAutomatedSecurityFixes({
      owner: gh.owner,
      repo: gh.repo,
    });
  },
  "vulnerability-alerts": async (gh) => {
    await gh.octokit.rest.repos.enableVulnerabilityAlerts({
      owner: gh.owner,
      repo: gh.repo,
    });
  },
};

/** Generator for controls with `fix: { type: github-setting, setting }`. */
export const githubSettingGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "github-setting") return [];
  const { setting } = control.fix;
  const action = settingActions[setting];
  if (!action) return [];

  return [
    {
      type: "effect",
      controlId: control.id,
      summary: `apply GitHub setting: ${setting}`,
      run: async () => {
        const gh = await ctx.github();
        if (!gh) {
          throw new Error(
            "no GitHub token or repository slug; cannot apply the setting",
          );
        }
        await action(gh);
      },
    },
  ];
};
