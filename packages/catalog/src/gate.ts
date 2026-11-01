// Gate schema. A gate (packages/catalog/gates/<phase>.yml) selects a set of
// controls that must pass for a phase; its colour is computed from their results.
import { z } from "zod";

import { LANE_KEYS, PHASE_KEYS, SEVERITIES } from "./taxonomy.js";

/**
 * A control is in a gate if it matches ANY selector. With `id`, it is an exact
 * control; otherwise the present `lane`/`phase`/`minSeverity` fields AND together
 * (`minSeverity: high` means "this severity or more severe").
 */
export const GateSelectorSchema = z
  .strictObject({
    id: z.string().optional(),
    lane: z.enum(LANE_KEYS).optional(),
    phase: z.enum(PHASE_KEYS).optional(),
    minSeverity: z.enum(SEVERITIES).optional(),
  })
  .refine(
    (s) => s.id ?? s.lane ?? s.phase ?? s.minSeverity,
    "a selector needs at least one of id, lane, phase, or minSeverity",
  );

export const GateSchema = z.strictObject({
  phase: z.enum(PHASE_KEYS),
  title: z.string().min(1).optional(),
  select: z.array(GateSelectorSchema).min(1),
});

export type GateSelector = z.infer<typeof GateSelectorSchema>;
export type Gate = z.infer<typeof GateSchema>;
