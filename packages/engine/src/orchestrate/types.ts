// Types for the orchestration layer: turning a natural-language feature/fix request
// into a gated pull request. A read-only planner produces a BuildPlan (what the user
// approves); a write-capable agent then implements it in an isolated worktree, which
// is verified against the repo's checks + the factory gate before a PR is opened.

/** One unit of work in a build plan. */
export interface BuildTask {
  title: string;
  /** What to do and why, for the implementer agent. */
  detail: string;
  /** Repo-relative files/dirs this task is expected to touch. */
  paths: string[];
}

/** The plan a human approves before any code is written. */
export interface BuildPlan {
  /** The original request, echoed back. */
  request: string;
  /** One-paragraph summary of the approach. */
  summary: string;
  /** Floor-plan system titles/ids the change affects. */
  affectedSystems: string[];
  tasks: BuildTask[];
  /** How the build will know it's done (drives the verify step's intent). */
  acceptanceCriteria: string[];
  /** Risks / things a reviewer should watch for. */
  risks: string[];
}

/** One acceptance check run against the built worktree. */
export interface VerifyCheck {
  /** e.g. "test", "lint", "typecheck", "factory-gate". */
  name: string;
  passed: boolean;
  /** Whether the check was actually run (false → not present / skipped). */
  ran: boolean;
  /** Truncated command output / reason, for display and for the fix-loop. */
  output: string;
}

export interface VerifyResult {
  /** True when every check that ran passed. */
  passed: boolean;
  checks: VerifyCheck[];
}

/** The outcome of a full build run. */
export interface BuildResult {
  branch: string;
  base: string;
  /** Absolute path of the (now-removed) worktree the build ran in. */
  worktree: string;
  plan: BuildPlan;
  /** The final verification after the last iteration. */
  verify: VerifyResult;
  /** How many implement→verify rounds ran (1 = passed first try). */
  iterations: number;
  /** True when changes were committed + pushed. */
  pushed: boolean;
  /** The opened/updated PR, or null (local-only, or nothing to push). */
  pr: { number: number; url: string; reused: boolean } | null;
  /** A short summary from the implementer agent. */
  notes: string;
}

/** Progress emitted as a build runs, streamed to the UI. */
export interface BuildProgress {
  phase:
    "plan" | "worktree" | "implement" | "verify" | "iterate" | "pr" | "done";
  message: string;
  done: number;
  total: number;
}
