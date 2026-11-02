import type { Control } from "@arynbht/factory-catalog";

import { generateArtifact } from "../ai/generate.js";
import type { AuditContext } from "../context.js";
import type { Change, Generator } from "./types.js";

/**
 * Generator for controls with `fix: { type: claude, task }`. Runs the task's AI
 * prompt against secret-guarded context and emits the generated file as a `create`
 * change (never clobbering a human file). The call uses the context's AI client, so
 * it needs an `ANTHROPIC_API_KEY` (or an injected transport in tests); the gap
 * report is not threaded here — control-wired tasks rely on the control + task globs.
 */
export const claudeGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "claude") return [];
  const result = await generateArtifact(ctx, control.fix.task, {
    client: ctx.ai(),
    date: ctx.now.toISOString().slice(0, 10),
    control,
  });
  return [result.change];
};
