import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import { runTool, ToolNotFoundError } from "./exec.js";
import type { DetectorResult } from "./types.js";

type ScorecardConfig = Extract<DetectorConfig, { type: "scorecard" }>;

/** Default minimum acceptable Scorecard check score when a control omits `min`. */
const DEFAULT_MIN_SCORE = 7;

/**
 * Pull a named check's score (0-10, or -1 for inconclusive) out of OpenSSF
 * Scorecard's `--format json` output. Returns null if the output is not JSON or
 * the check is absent.
 */
export function extractCheckScore(
  stdout: string,
  check: string,
): number | null {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }

  const checks = (data as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return null;

  for (const entry of checks) {
    if (
      entry &&
      typeof entry === "object" &&
      "name" in entry &&
      typeof entry.name === "string" &&
      entry.name.toLowerCase() === check.toLowerCase()
    ) {
      const score = (entry as { score?: unknown }).score;
      return typeof score === "number" ? score : null;
    }
  }
  return null;
}

/** Runs OpenSSF Scorecard and asserts a named check meets a minimum score. */
export async function scorecard(
  ctx: AuditContext,
  config: ScorecardConfig,
): Promise<DetectorResult> {
  const args = [
    "--local",
    ctx.repoPath,
    "--checks",
    config.check,
    "--format",
    "json",
  ];

  let result;
  try {
    result = await runTool("scorecard", args, ctx.repoPath);
  } catch (err) {
    if (err instanceof ToolNotFoundError) {
      return {
        status: "skip",
        message: "OpenSSF scorecard is not installed; skipping",
        remediation: "install scorecard (github.com/ossf/scorecard)",
      };
    }
    return {
      status: "skip",
      message: `scorecard failed: ${(err as Error).message}`,
    };
  }

  const score = extractCheckScore(result.stdout, config.check);
  if (score === null) {
    return {
      status: "skip",
      message: `scorecard reported no score for "${config.check}"`,
    };
  }
  if (score < 0) {
    return {
      status: "skip",
      message: `scorecard check "${config.check}" was inconclusive`,
    };
  }

  const min = config.min ?? DEFAULT_MIN_SCORE;
  return score >= min
    ? { status: "pass", message: `${config.check} score ${score} ≥ ${min}` }
    : {
        status: "fail",
        message: `${config.check} score ${score} < ${min}`,
        remediation: `raise the "${config.check}" Scorecard score`,
      };
}
