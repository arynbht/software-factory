import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import { generators } from "./registry.js";
import type { Change } from "./types.js";

/** A generator that threw while planning a control's fix. */
export interface GeneratorError {
  controlId: string;
  fixType: string;
  message: string;
}

/** The planned changes plus any generator failures, so neither is lost. */
export interface PlanResult {
  changes: Change[];
  errors: GeneratorError[];
}

/** Produce the changes that would fix one control (empty if it has no generator). */
export async function planControl(
  ctx: AuditContext,
  control: Control,
): Promise<PlanResult> {
  if (!control.fix) return { changes: [], errors: [] };
  const generator = generators[control.fix.type];
  if (!generator) return { changes: [], errors: [] };
  try {
    return { changes: await generator(ctx, control), errors: [] };
  } catch (err) {
    // A failing generator must not abort the whole fix run — but it must not be
    // silently dropped either, or the user sees "nothing to fix" when the real
    // story is "a generator is broken". Collect it so callers can surface it.
    return {
      changes: [],
      errors: [
        {
          controlId: control.id,
          fixType: control.fix.type,
          message: (err as Error).message,
        },
      ],
    };
  }
}

/** Collect the changes (and generator errors) for a list of controls, in order. */
export async function planControls(
  ctx: AuditContext,
  controls: Control[],
): Promise<PlanResult> {
  const changes: Change[] = [];
  const errors: GeneratorError[] = [];
  for (const control of controls) {
    const result = await planControl(ctx, control);
    changes.push(...result.changes);
    errors.push(...result.errors);
  }
  return { changes, errors };
}
