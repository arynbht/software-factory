// Build adapter: plan a feature/fix (read-only, floor-plan-grounded) and run the
// build pipeline (write-agent in an isolated worktree → verify → gated PR). Both need
// the Claude CLI; the PR step needs a GitHub token. Gated off under the E2E seam so
// tests never spawn real write-agents. Electron-free except the progress callback.
import {
  buildContext,
  claudeCliAvailable,
  planFeature,
  runBuild,
  type BuildPlan,
  type BuildProgress,
} from "@arynbht/factory-engine";

import type { BuildPlanView, BuildResult } from "../../shared/ipc";

/** The build pipeline spawns real `claude` write-agents — never under E2E. */
function buildAvailable(): Promise<boolean> {
  if (process.env.FACTORY_E2E === "1") return Promise.resolve(false);
  return claudeCliAvailable();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyPlan(request: string): BuildPlan {
  return {
    request,
    summary: "",
    affectedSystems: [],
    tasks: [],
    acceptanceCriteria: [],
    risks: [],
  };
}

/** Draft a plan for approval, or report that a build can't run (no Claude CLI). */
export async function planBuild(
  repoPath: string,
  description: string,
  token?: string,
): Promise<BuildPlanView> {
  if (!(await buildAvailable())) {
    return { plan: emptyPlan(description), buildAvailable: false };
  }
  const ctx = buildContext(repoPath, token ? { token } : {});
  const plan = await planFeature(ctx, description);
  return { plan, buildAvailable: true };
}

/** Run an approved plan to a gated PR, streaming progress. */
export async function runBuildTask(
  repoPath: string,
  plan: BuildPlan,
  token: string | undefined,
  onProgress: (p: BuildProgress) => void,
  signal?: AbortSignal,
): Promise<BuildResult> {
  const ctx = buildContext(repoPath, token ? { token } : {});
  return runBuild(ctx, plan, {
    date: today(),
    onProgress,
    push: true,
    ...(signal ? { signal } : {}),
  });
}
