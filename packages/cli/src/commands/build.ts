// `factory build "<description>"` — the orchestration layer from the terminal. It
// plans the change (read-only, floor-plan-grounded) and prints the plan; with --yes
// it then builds it with a write-agent in an isolated worktree, self-checks, and opens
// a gated PR. The plan/build steps are injectable so the command is unit-tested
// without spawning `claude` or touching git.
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type BuildOptions,
  type BuildPlan,
  type BuildProgress,
  type BuildResult,
  buildContext,
  planFeature,
  resolveToken,
  runBuild,
} from "@arynbht/factory-engine";

import { today as isoToday } from "../dates.js";

export interface BuildFlags {
  /** Approve the plan and build it (without this, plan only). */
  yes?: boolean;
  /** commander's --no-push sets this false → stop at a local branch. */
  push?: boolean;
  token?: string;
  model?: string;
  color?: boolean;
}

export interface RunBuildCommandOptions {
  today?: string;
  /** GitHub token (or null to force offline in tests). */
  token?: string | null | undefined;
  /** Inject the planner (tests). */
  plan?: (
    ctx: ReturnType<typeof buildContext>,
    description: string,
  ) => Promise<BuildPlan>;
  /** Inject the builder (tests). */
  build?: (
    ctx: ReturnType<typeof buildContext>,
    plan: BuildPlan,
    options: BuildOptions,
  ) => Promise<BuildResult>;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function renderPlan(plan: BuildPlan): string {
  const lines = [`\nPlan: ${plan.summary || "(no summary)"}`];
  if (plan.affectedSystems.length > 0) {
    lines.push(`Affected systems: ${plan.affectedSystems.join(", ")}`);
  }
  if (plan.tasks.length > 0) {
    lines.push("", "Tasks:");
    plan.tasks.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.title}${t.detail ? ` — ${t.detail}` : ""}`);
      if (t.paths.length > 0) lines.push(`     ${t.paths.join(", ")}`);
    });
  }
  if (plan.acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance criteria:");
    plan.acceptanceCriteria.forEach((c) => lines.push(`  - ${c}`));
  }
  if (plan.risks.length > 0) {
    lines.push("", "Risks:");
    plan.risks.forEach((r) => lines.push(`  - ${r}`));
  }
  return `${lines.join("\n")}\n`;
}

function renderResult(result: BuildResult): string {
  const mark = (c: { ran: boolean; passed: boolean }): string =>
    c.ran ? (c.passed ? "✓" : "✗") : "–";
  const lines = [
    `\n${result.verify.passed ? "Build passed" : "Build did not pass"} (${result.iterations} iteration${result.iterations === 1 ? "" : "s"})`,
    ...result.verify.checks.map(
      (c) => `  ${mark(c)} ${c.name}${c.ran ? "" : " (skipped)"}`,
    ),
  ];
  if (result.pr) {
    lines.push(
      `\n${result.pr.reused ? "Updated" : "Opened"} PR #${result.pr.number}: ${result.pr.url}`,
    );
  } else if (result.verify.passed) {
    lines.push(`\nCommitted to ${result.branch} (not pushed).`);
  } else {
    lines.push(
      `\nChecks did not pass — no PR opened. Attempt is on ${result.branch}.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runBuildCommand(
  description: string,
  path: string,
  flags: BuildFlags,
  options: RunBuildCommandOptions = {},
): Promise<number> {
  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) {
      console.error(`factory build: not a directory: ${path}`);
      return 1;
    }
  } catch {
    console.error(`factory build: path not found: ${path}`);
    return 1;
  }

  const token =
    options.token === null
      ? undefined
      : (options.token ?? resolveToken(flags.token));
  const ctx = buildContext(root, { token });
  const model = flags.model;

  const planFn =
    options.plan ?? ((c, d) => planFeature(c, d, model ? { model } : {}));
  const buildFn = options.build ?? ((c, p, o) => runBuild(c, p, o));

  const out = process.stdout;
  out.write(`Planning: ${description}\n`);
  let plan: BuildPlan;
  try {
    plan = await planFn(ctx, description);
  } catch (err) {
    console.error(`factory build: ${msg(err)}`);
    return 1;
  }
  out.write(renderPlan(plan));

  if (!flags.yes) {
    out.write("\nRe-run with --yes to approve and build this plan.\n");
    return 0;
  }

  let result: BuildResult;
  try {
    result = await buildFn(ctx, plan, {
      date: options.today ?? isoToday(),
      push: flags.push !== false,
      ...(model ? { model } : {}),
      onProgress: (p: BuildProgress) =>
        out.write(`  [${p.phase}] ${p.message}\n`),
    });
  } catch (err) {
    console.error(`factory build: ${msg(err)}`);
    return 1;
  }

  out.write(renderResult(result));
  return result.verify.passed ? 0 : 1;
}
