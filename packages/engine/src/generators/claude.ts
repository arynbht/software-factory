import type { Control } from "@arynbht/factory-catalog";

import { AiKeyError } from "../ai/client.js";
import { generateArtifact } from "../ai/generate.js";
import type { AuditContext } from "../context.js";
import type { Change, Generator } from "./types.js";

/**
 * Generator for controls with `fix: { type: claude, task }`. Runs the task's AI
 * prompt against secret-guarded context and emits the generated file as a `create`
 * change (never clobbering a human file). The call uses the context's AI client, so
 * it needs an `ANTHROPIC_API_KEY` (or an injected transport in tests); the gap report
 * is not threaded here — control-wired tasks rely on the control + task globs.
 *
 * Without a key it degrades to no change (rather than aborting a mixed `factory fix`
 * run): AI drafts are produced on demand via `factory ai`, which surfaces the missing
 * key explicitly.
 */
export const claudeGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "claude") return [];
  try {
    const result = await generateArtifact(ctx, control.fix.task, {
      client: ctx.ai(),
      date: ctx.now.toISOString().slice(0, 10),
      control,
    });
    return [result.change];
  } catch (err) {
    if (err instanceof AiKeyError) return [];
    throw err;
  }
};
