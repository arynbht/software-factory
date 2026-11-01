import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import type { DetectorResult } from "./types.js";
import { splitGlobs } from "./util.js";

type FileExistsConfig = Extract<DetectorConfig, { type: "file-exists" }>;

/** Passes if at least one file matches the (possibly `a|b`) glob. */
export async function fileExists(
  ctx: AuditContext,
  config: FileExistsConfig,
): Promise<DetectorResult> {
  const matches = await ctx.glob(splitGlobs(config.path));
  if (matches.length > 0) {
    return { status: "pass", message: `found ${matches[0]}` };
  }
  return {
    status: "fail",
    message: `no file matching "${config.path}"`,
    remediation: `create ${config.path}`,
  };
}
