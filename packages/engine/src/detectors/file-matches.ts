import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import type { DetectorResult } from "./types.js";
import { compileRegex, splitGlobs } from "./util.js";

type FileMatchesConfig = Extract<DetectorConfig, { type: "file-matches" }>;

/** Passes if some file matching the glob contains content matching the regex. */
export async function fileMatches(
  ctx: AuditContext,
  config: FileMatchesConfig,
): Promise<DetectorResult> {
  let regex: RegExp;
  try {
    regex = compileRegex(config.pattern);
  } catch {
    return {
      status: "skip",
      message: `invalid regex pattern: ${config.pattern}`,
    };
  }

  const matches = await ctx.glob(splitGlobs(config.path));
  if (matches.length === 0) {
    return {
      status: "fail",
      message: `no file matching "${config.path}"`,
      remediation: `create ${config.path}`,
    };
  }

  for (const rel of matches) {
    const content = await ctx.readFile(rel);
    if (content !== null && regex.test(content)) {
      return { status: "pass", message: `${rel} matches /${config.pattern}/` };
    }
  }

  return {
    status: "fail",
    message: `no file matching "${config.path}" contains /${config.pattern}/`,
    remediation: `add content matching /${config.pattern}/`,
  };
}
