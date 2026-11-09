import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import type { DetectorResult } from "./types.js";

type ReviewedConfig = Extract<DetectorConfig, { type: "reviewed" }>;

/** The provenance header `factory ai` writes (see ai/generate.ts). */
const GENERATED = /<!--\s*factory:generated[\s\S]*?-->/;
const REVIEWED = /^reviewed-by:[ \t]*\S/m;
const TASK = /^task:[ \t]*(\S+)/m;

/** Where drafts land: `factory ai` writes Markdown. */
const DRAFTS = ["**/*.md", "**/*.mdx", "**/*.markdown"];

/**
 * Claude drafts, humans sign. Finds drafts by their `factory:generated` header —
 * not by a path glob — and requires every one (for `task`, when given) to carry
 * a filled `reviewed-by:` line. Human-written files have no header and don't
 * count either way; whether the artifact exists at all is the control's other
 * detector's job.
 */
export async function reviewed(
  ctx: AuditContext,
  config: ReviewedConfig,
): Promise<DetectorResult> {
  const unreviewed: string[] = [];
  let drafts = 0;
  for (const rel of await ctx.glob(DRAFTS)) {
    const header = GENERATED.exec((await ctx.readFile(rel)) ?? "")?.[0];
    if (!header) continue;
    if (config.task && TASK.exec(header)?.[1] !== config.task) continue;
    drafts++;
    if (!REVIEWED.test(header)) unreviewed.push(rel);
  }
  const scope = config.task ? `\`${config.task}\` ` : "";
  if (unreviewed.length > 0) {
    return {
      status: "fail",
      message: `unreviewed Claude ${scope}draft: ${unreviewed.join(", ")}`,
      remediation: "review each draft and fill in its `reviewed-by:` line",
    };
  }
  return {
    status: "pass",
    message:
      drafts === 0
        ? `no Claude ${scope}drafts`
        : `${drafts} Claude ${scope}draft(s), all reviewed`,
  };
}
