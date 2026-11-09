import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import { registry } from "./registry.js";
import type { DetectorResult } from "./types.js";

/**
 * Dispatch one detector config to its implementation. Unimplemented types and
 * thrown errors become `skip` so a single bad detector never aborts a run.
 */
export async function runDetector(
  ctx: AuditContext,
  config: DetectorConfig,
): Promise<DetectorResult> {
  if (config.type === "any-of") return anyOf(ctx, config.detect);

  const fn = registry[config.type];
  if (!fn) {
    return {
      status: "skip",
      message: `detector "${config.type}" is not implemented yet`,
    };
  }

  try {
    return await fn(ctx, config);
  } catch (err) {
    return {
      status: "skip",
      message: `detector "${config.type}" errored: ${(err as Error).message}`,
    };
  }
}

/**
 * Passes on the first alternative that passes. Fails only when every alternative
 * fails; if none passed but one could not decide, the result is `skip` (unknown,
 * never a pass).
 */
async function anyOf(
  ctx: AuditContext,
  alternatives: DetectorConfig[],
): Promise<DetectorResult> {
  const results: DetectorResult[] = [];
  for (const alt of alternatives) {
    const result = await runDetector(ctx, alt);
    if (result.status === "pass") return result;
    results.push(result);
  }
  const message = results.map((r) => r.message).join("; ");
  if (results.every((r) => r.status === "fail")) {
    return {
      status: "fail",
      message: `none of ${results.length} alternatives passed: ${message}`,
      remediation: results.find((r) => r.remediation)?.remediation,
    };
  }
  return { status: "skip", message };
}
