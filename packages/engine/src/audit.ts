import type { Control, Profile, Waiver } from "@arynbht/factory-catalog";

import type { AuditContext } from "./context.js";
import { type ControlResult, evaluateControl } from "./evaluate.js";
import { gatherRepoFacts, type RepoFacts } from "./applicability.js";

export interface AuditOptions {
  /** Max controls evaluated concurrently (detectors within a control are serial). */
  concurrency?: number | undefined;
  /** Reference time for evidence/waiver expiry; defaults to now. */
  now?: Date | undefined;
  /** Profile for applicability; if omitted, loaded from the context. */
  profile?: Profile | null | undefined;
  /** Active waivers; if omitted, loaded from the context. */
  waivers?: Waiver[] | undefined;
  /** Repo facts for applicability (stacks, `{ file }` globs); detected if omitted. */
  facts?: RepoFacts | undefined;
}

/**
 * Evaluate every control against a repo with a bounded concurrency, preserving
 * input order in the results.
 */
export async function evaluateControls(
  controls: Control[],
  ctx: AuditContext,
  options: AuditOptions = {},
): Promise<ControlResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const profile = options.profile ?? (await ctx.profile());
  const waivers = options.waivers ?? (await ctx.waivers());
  const facts = options.facts ?? (await gatherRepoFacts(ctx, controls));
  const results: ControlResult[] = new Array<ControlResult>(controls.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < controls.length) {
      const index = next++;
      const control = controls[index];
      if (!control) continue;
      results[index] = await evaluateControl(control, ctx, {
        now: options.now,
        profile,
        waivers,
        facts,
      });
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, controls.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
