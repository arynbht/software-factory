import { simpleGit } from "simple-git";

import type { AuditContext } from "./context.js";
import { applyChanges, type ChangeResult } from "./generators/apply.js";
import type { Change } from "./generators/types.js";
import {
  openOrReusePr,
  type OpenPrParams,
  type PrResult,
} from "./github/pr.js";

export class FixPrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixPrError";
  }
}

export interface FixPrOptions {
  /** Label used in the branch name and PR title, e.g. "scaffold" or "all". */
  gate: string;
  /** Today's date as YYYY-MM-DD (passed in; the engine never reads the clock). */
  date: string;
  /** control id → title, for a readable PR body. */
  titles?: Record<string, string>;
  /** Git remote to push to (default "origin"). */
  remote?: string;
  /**
   * Override the PR-opening step (tests inject a fake so no Octokit/network is
   * needed). Defaults to opening/reusing a PR via the context's GitHub client.
   */
  openPr?: (params: OpenPrParams) => Promise<PrResult>;
}

export interface FixPrResult {
  branch: string;
  base: string;
  changeResults: ChangeResult[];
  commits: { controlId: string; message: string; paths: string[] }[];
  pushed: boolean;
  pr: PrResult | null;
  /** Effects (e.g. GitHub settings) skipped because they can't live in a PR. */
  skippedEffects: number;
}

const STATE_FILE = ".factory/state.json";

/**
 * Apply file changes on a dedicated `factory/<date>-<gate>` branch, commit one per
 * control, push, and open (or reuse) a pull request. Effects are skipped — a PR
 * can only carry file changes, not repo-setting mutations. Requires a clean
 * working tree so the PR contains only factory changes. If nothing changed, no
 * branch is left behind and no PR is opened.
 */
export async function openFixPr(
  ctx: AuditContext,
  changes: Change[],
  options: FixPrOptions,
): Promise<FixPrResult> {
  const git = simpleGit(ctx.repoPath);
  const remote = options.remote ?? "origin";

  if (!(await git.checkIsRepo())) {
    throw new FixPrError(`${ctx.repoPath} is not a git repository`);
  }
  const status = await git.status();
  if (!status.isClean()) {
    throw new FixPrError(
      "working tree has uncommitted changes; commit or stash them before --pr",
    );
  }

  const base = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  const branch = `factory/${options.date}-${options.gate}`;

  const fileChanges = changes.filter((c) => c.type === "file");
  const skippedEffects = changes.length - fileChanges.length;

  const local = await git.branchLocal();
  const reusingBranch = local.all.includes(branch);
  if (reusingBranch) {
    await git.checkout(branch);
  } else {
    await git.checkoutLocalBranch(branch);
  }

  let changeResults: ChangeResult[] = [];
  const commits: FixPrResult["commits"] = [];
  try {
    changeResults = await applyChanges(ctx.repoPath, fileChanges, {
      mode: "write",
    });

    // Group written files by control so each becomes its own commit.
    const byControl = new Map<string, string[]>();
    for (const r of changeResults) {
      if (
        r.type === "file" &&
        (r.action === "create" || r.action === "update") &&
        r.path
      ) {
        const paths = byControl.get(r.controlId) ?? [];
        paths.push(r.path);
        byControl.set(r.controlId, paths);
      }
    }

    for (const [controlId, paths] of byControl) {
      await git.add(paths);
      const title = options.titles?.[controlId];
      const message = title
        ? `factory: ${controlId} — ${title}`
        : `factory: fix ${controlId}`;
      await git.commit(message);
      commits.push({ controlId, message, paths });
    }

    // Fold the managed-hash registry into the branch so idempotency survives.
    const after = await git.status();
    if (after.files.some((f) => f.path === STATE_FILE)) {
      await git.add([STATE_FILE]);
      await git.commit("factory: update managed-file registry");
    }
  } catch (err) {
    // Leave the tree on the base branch if we failed partway through.
    await git.checkout(base).catch(() => undefined);
    if (!reusingBranch) {
      await git.deleteLocalBranch(branch, true).catch(() => undefined);
    }
    throw err;
  }

  // Nothing to propose: undo the branch switch and report an empty result without
  // pushing or touching a PR. A freshly-created branch is removed; a pre-existing
  // (reused) branch is left as-is so we don't disturb an open PR.
  if (commits.length === 0) {
    await git.checkout(base);
    if (!reusingBranch) {
      await git.deleteLocalBranch(branch, true).catch(() => undefined);
    }
    return {
      branch,
      base,
      changeResults,
      commits,
      pushed: false,
      pr: null,
      skippedEffects,
    };
  }

  await git.push([remote, branch, "--set-upstream"]);

  const openPr = options.openPr ?? (await defaultOpenPr(ctx));
  const pr = await openPr({
    head: branch,
    base,
    title: prTitle(commits.length, options.gate),
    body: prBody(commits, skippedEffects),
  });

  await git.checkout(base);

  return {
    branch,
    base,
    changeResults,
    commits,
    pushed: true,
    pr,
    skippedEffects,
  };
}

async function defaultOpenPr(
  ctx: AuditContext,
): Promise<(params: OpenPrParams) => Promise<PrResult>> {
  const gh = await ctx.github();
  if (!gh) {
    throw new FixPrError(
      "no GitHub token or repository slug; cannot open a pull request",
    );
  }
  return (params) => openOrReusePr(gh, params);
}

function prTitle(count: number, gate: string): string {
  return `factory: ${count} fix${count === 1 ? "" : "es"} for ${gate}`;
}

function prBody(
  commits: FixPrResult["commits"],
  skippedEffects: number,
): string {
  const lines = [
    "Automated remediation from `factory fix --pr`.",
    "",
    "### Controls fixed",
    ...commits.map(
      (c) =>
        `- \`${c.controlId}\` — ${c.paths.map((p) => `\`${p}\``).join(", ")}`,
    ),
  ];
  if (skippedEffects > 0) {
    lines.push(
      "",
      `_${skippedEffects} setting change(s) could not be included in a PR; apply them with \`factory fix --write\`._`,
    );
  }
  lines.push(
    "",
    "Claude drafts, humans sign — review the diff before merging.",
  );
  return lines.join("\n");
}
