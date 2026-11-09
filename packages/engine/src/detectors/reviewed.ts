import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import type { DetectorResult } from "./types.js";
import { splitGlobs } from "./util.js";

type ReviewedConfig = Extract<DetectorConfig, { type: "reviewed" }>;

/** The provenance header `factory ai` writes (see ai/generate.ts). */
const GENERATED = /<!--\s*factory:generated[\s\S]*?-->/;
const REVIEWED = /^reviewed-by:[ \t]*\S/m;

/**
 * Claude drafts, humans sign. Passes when some matching file is either written
 * by a human (no `factory:generated` header) or a factory draft whose header has
 * a filled `reviewed-by:` line. An unreviewed draft alone does not pass.
 */
export async function reviewed(
  ctx: AuditContext,
  config: ReviewedConfig,
): Promise<DetectorResult> {
  const matches = await ctx.glob(splitGlobs(config.path));
  if (matches.length === 0) {
    return {
      status: "fail",
      message: `no file matching "${config.path}"`,
      remediation: `create ${config.path}`,
    };
  }

  const drafts: string[] = [];
  for (const rel of matches) {
    const content = (await ctx.readFile(rel)) ?? "";
    const header = GENERATED.exec(content)?.[0];
    if (!header) return { status: "pass", message: `${rel} (human-written)` };
    if (REVIEWED.test(header)) {
      return { status: "pass", message: `${rel} (draft, reviewed)` };
    }
    drafts.push(rel);
  }
  return {
    status: "fail",
    message: `unreviewed Claude draft: ${drafts.join(", ")}`,
    remediation: "review the draft and fill in its `reviewed-by:` line",
  };
}
