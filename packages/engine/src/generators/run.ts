import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import { generators } from "./registry.js";
import type { Change } from "./types.js";

/** Produce the changes that would fix one control (empty if it has no generator). */
export async function planControl(
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> {
  if (!control.fix) return [];
  const generator = generators[control.fix.type];
  if (!generator) return [];
  try {
    return await generator(ctx, control);
  } catch {
    // A failing generator must not abort the whole fix run.
    return [];
  }
}

/** Collect the changes for a list of controls, in order. */
export async function planControls(
  ctx: AuditContext,
  controls: Control[],
): Promise<Change[]> {
  const all: Change[] = [];
  for (const control of controls) {
    all.push(...(await planControl(ctx, control)));
  }
  return all;
}
