// The build pipeline: take an approved BuildPlan and carry it to a gated PR. All work
// happens in an isolated git worktree (worktree.ts), so the user's checkout is never
// touched. A write-capable agent implements the plan; the result is verified against
// the repo's checks + the factory gate; failures feed a bounded fix-loop; then the
// branch is committed, pushed, and a PR is opened. Every external effect (the agent,
// git, verify, the PR call) is an injectable seam, so the whole flow is unit-tested
// with no `claude`, git, or network — mirroring fix-pr.ts.
import type { AuditContext } from "../context.js";
import {
  openOrReusePr,
  type OpenPrParams,
  type PrResult,
} from "../github/pr.js";
import type {
  BuildPlan,
  BuildProgress,
  BuildResult,
  VerifyResult,
} from "./types.js";
import { verify as defaultVerify } from "./verify.js";
import {
  commitAll,
  createWorktree,
  pushBranch,
  removeWorktree,
  type Worktree,
} from "./worktree.js";
import { runWriteAgent, type WriteAgentRunner } from "./write-agent.js";

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

/** Git operations the pipeline needs, injectable as a group for tests. */
export interface GitOps {
  createWorktree(repoPath: string, branch: string): Promise<Worktree>;
  commitAll(worktreePath: string, message: string): Promise<boolean>;
  pushBranch(
    worktreePath: string,
    remote: string,
    branch: string,
  ): Promise<void>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
}

const defaultGit: GitOps = {
  createWorktree,
  commitAll,
  pushBranch,
  removeWorktree,
};

export interface BuildOptions {
  /** Today's date as YYYY-MM-DD (the engine never reads the clock). */
  date: string;
  /** Inject the implementer agent (tests). Default spawns the write-agent. */
  writeAgent?: WriteAgentRunner;
  /** Inject the verifier (tests). Default runs repo checks + factory gate. */
  verify?: (dir: string) => Promise<VerifyResult>;
  /** Inject git ops (tests). Default uses real worktrees. */
  git?: GitOps;
  /** Inject the PR opener (tests). Default opens/reuses via the GitHub client. */
  openPr?: (params: OpenPrParams) => Promise<PrResult>;
  remote?: string;
  /** Max implement→verify rounds before giving up (default 3). */
  maxIterations?: number;
  /** Push + open a PR (default true). False → stop at a local branch. */
  push?: boolean;
  model?: string;
  onProgress?: (p: BuildProgress) => void;
  signal?: AbortSignal;
}

const IMPLEMENT_SYSTEM = [
  "You are implementing an APPROVED plan inside an isolated git worktree. Make the smallest correct change that satisfies the plan and its acceptance criteria.",
  "Install dependencies if needed and run the repo's own typecheck/lint/test commands to check your work before finishing.",
  "Do NOT commit, push, or create branches — the harness handles git. Only edit files and run build/test commands.",
  "When done, reply with a short plain-text summary of what you changed (no JSON).",
].join("\n");

const FIX_SYSTEM = [
  "You are fixing failing acceptance checks for a change you made in an isolated git worktree.",
  "Address every failing check below, then re-run the relevant commands to confirm. Do NOT commit or push.",
  "Reply with a short plain-text summary of the fixes.",
].join("\n");

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "change"
  );
}

function renderPlan(plan: BuildPlan): string {
  return [
    `Request: ${plan.request}`,
    "",
    `Approach: ${plan.summary}`,
    "",
    "Tasks:",
    ...plan.tasks.map(
      (t, i) =>
        `${i + 1}. ${t.title} — ${t.detail}${t.paths.length ? ` [${t.paths.join(", ")}]` : ""}`,
    ),
    "",
    "Acceptance criteria:",
    ...plan.acceptanceCriteria.map((c) => `- ${c}`),
  ].join("\n");
}

function failingText(verify: VerifyResult): string {
  return verify.checks
    .filter((c) => c.ran && !c.passed)
    .map((c) => `### ${c.name}\n${c.output}`)
    .join("\n\n");
}

function prBody(
  plan: BuildPlan,
  verify: VerifyResult,
  iterations: number,
): string {
  const checks = verify.checks
    .map(
      (c) => `- ${c.ran ? (c.passed ? "✅" : "❌") : "⚪️ (skipped)"} ${c.name}`,
    )
    .join("\n");
  return [
    `Automated build from the Software Factory orchestrator.`,
    "",
    `**Request:** ${plan.request}`,
    "",
    `**Approach:** ${plan.summary}`,
    "",
    "### Acceptance checks",
    checks,
    "",
    `Built in ${iterations} iteration${iterations === 1 ? "" : "s"}.`,
    "",
    "Claude drafts, humans sign — review the diff before merging.",
  ].join("\n");
}

/** Run a build from an approved plan to a gated PR (or a local branch). */
export async function runBuild(
  ctx: AuditContext,
  plan: BuildPlan,
  options: BuildOptions,
): Promise<BuildResult> {
  const git = options.git ?? defaultGit;
  const verify = options.verify ?? ((dir) => defaultVerify(dir));
  const runAgent = options.writeAgent;
  const remote = options.remote ?? "origin";
  const maxIterations = options.maxIterations ?? 3;
  const push = options.push ?? true;
  const report = (p: BuildProgress): void => {
    if (options.signal?.aborted)
      throw new DOMException("aborted", "AbortError");
    options.onProgress?.(p);
  };

  const branch = `factory/build-${options.date}-${slugify(plan.request)}`;

  report({
    phase: "worktree",
    message: "Creating isolated worktree…",
    done: 0,
    total: 1,
  });
  const worktree = await git.createWorktree(ctx.repoPath, branch);

  let notes = "";
  let result: VerifyResult = { passed: false, checks: [] };
  let iterations = 0;
  let pushed = false;
  let pr: PrResult | null = null;

  try {
    // Implement ------------------------------------------------------------
    report({
      phase: "implement",
      message: "Implementing the plan…",
      done: 0,
      total: 1,
    });
    const impl = await runWriteAgent(
      {
        cwd: worktree.path,
        system: IMPLEMENT_SYSTEM,
        prompt: renderPlan(plan),
        ...(options.model ? { model: options.model } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      runAgent,
    );
    notes = impl.text;
    iterations = 1;

    // Verify + bounded fix-loop -------------------------------------------
    report({
      phase: "verify",
      message: "Running acceptance checks…",
      done: 0,
      total: 1,
    });
    result = await verify(worktree.path);

    while (!result.passed && iterations < maxIterations) {
      report({
        phase: "iterate",
        message: `Fixing failed checks (round ${iterations + 1}/${maxIterations})…`,
        done: iterations,
        total: maxIterations,
      });
      const fix = await runWriteAgent(
        {
          cwd: worktree.path,
          system: FIX_SYSTEM,
          prompt: `These acceptance checks failed:\n\n${failingText(result)}`,
          ...(options.model ? { model: options.model } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        runAgent,
      );
      notes = `${notes}\n\n${fix.text}`.trim();
      iterations += 1;
      report({
        phase: "verify",
        message: "Re-running acceptance checks…",
        done: 0,
        total: 1,
      });
      result = await verify(worktree.path);
    }

    // Commit always (so a failed attempt is still inspectable on the branch), but
    // only push + open a PR when the acceptance checks actually passed.
    const committed = await git.commitAll(
      worktree.path,
      `factory: build — ${plan.request.split("\n")[0]}`,
    );

    if (committed && push && result.passed) {
      report({
        phase: "pr",
        message: "Pushing and opening a PR…",
        done: 0,
        total: 1,
      });
      await git.pushBranch(worktree.path, remote, branch);
      const openPr = options.openPr ?? (await defaultOpenPr(ctx));
      pr = await openPr({
        head: branch,
        base: worktree.base,
        title: `factory: ${plan.request.split("\n")[0]}`,
        body: prBody(plan, result, iterations),
      });
      pushed = true;
    }
  } finally {
    await git.removeWorktree(ctx.repoPath, worktree.path);
  }

  report({ phase: "done", message: "Build complete", done: 1, total: 1 });

  return {
    branch,
    base: worktree.base,
    worktree: worktree.path,
    plan,
    verify: result,
    iterations,
    pushed,
    pr: pr ? { number: pr.number, url: pr.url, reused: pr.reused } : null,
    notes,
  };
}

async function defaultOpenPr(
  ctx: AuditContext,
): Promise<(params: OpenPrParams) => Promise<PrResult>> {
  const gh = await ctx.github();
  if (!gh) {
    throw new BuildError(
      "no GitHub token or repository slug; sign in to push the build as a PR",
    );
  }
  return (params) => openOrReusePr(gh, params);
}
