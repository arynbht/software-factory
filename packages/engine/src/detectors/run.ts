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
