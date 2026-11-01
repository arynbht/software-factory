import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "./context.js";
import { type ControlResult, evaluateControl } from "./evaluate.js";

export interface AuditOptions {
  /** Max controls evaluated concurrently (detectors within a control are serial). */
  concurrency?: number | undefined;
  /** Reference time for evidence expiry; defaults to now. */
  now?: Date | undefined;
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
  const results: ControlResult[] = new Array<ControlResult>(controls.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < controls.length) {
      const index = next++;
      const control = controls[index];
      if (!control) continue;
      results[index] = await evaluateControl(control, ctx, {
        now: options.now,
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
