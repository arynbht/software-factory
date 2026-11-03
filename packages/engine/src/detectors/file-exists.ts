import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import type { DetectorResult } from "./types.js";
import { splitGlobs } from "./util.js";

type FileExistsConfig = Extract<DetectorConfig, { type: "file-exists" }>;

/**
 * Passes if at least one file matches the (possibly `a|b`) glob, after removing
 * any file that also matches `exclude`. `exclude` lets a control ignore paths it
 * owns (e.g. the factory's own `factory.yml`) so they don't satisfy a "present"
 * check that is meant to be met by a real, user-facing file.
 */
export async function fileExists(
  ctx: AuditContext,
  config: FileExistsConfig,
): Promise<DetectorResult> {
  const patterns = splitGlobs(config.path);
  if (config.exclude) {
    // tinyglobby treats `!pattern` entries as negations of the positive globs.
    for (const ex of splitGlobs(config.exclude)) patterns.push(`!${ex}`);
  }
  const matches = await ctx.glob(patterns);
  if (matches.length > 0) {
    return { status: "pass", message: `found ${matches[0]}` };
  }
  const detail = config.exclude
    ? `no file matching "${config.path}" (excluding "${config.exclude}")`
    : `no file matching "${config.path}"`;
  return {
    status: "fail",
    message: detail,
    remediation: `create ${config.path}`,
  };
}
