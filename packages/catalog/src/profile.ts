// The profile schema. A profile (`.factory/profile.yml`) describes what a project
// is and the risks it carries, so the engine can decide which controls apply.
import { z } from "zod";

import {
  FLAG_KEYS,
  LANE_KEYS,
  PHASE_KEYS,
  PROJECT_TYPES,
  SEVERITIES,
} from "./taxonomy.js";

// Flags and lane toggles are explicit optional booleans so an unknown key is
// rejected (strict), catching typos that would otherwise silently mis-scope.
const FlagsSchema = z
  .strictObject(
    Object.fromEntries(
      FLAG_KEYS.map((key) => [key, z.boolean().optional()]),
    ) as Record<(typeof FLAG_KEYS)[number], z.ZodOptional<z.ZodBoolean>>,
  )
  .default({});

const LanesSchema = z
  .strictObject(
    Object.fromEntries(
      LANE_KEYS.map((key) => [key, z.boolean().optional()]),
    ) as Record<(typeof LANE_KEYS)[number], z.ZodOptional<z.ZodBoolean>>,
  )
  .optional();

export const ProfileSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1),
  type: z.enum(PROJECT_TYPES),
  stack: z.array(z.string()).default([]),
  /** Current lifecycle phase; set by `factory init`, inferred in M6. */
  phase: z.enum(PHASE_KEYS).optional(),
  flags: FlagsSchema,
  /** Optional per-lane on/off toggle; a lane absent here defaults to on. */
  lanes: LanesSchema,
  "severity-floor": z.enum(SEVERITIES).default("low"),
});

export type Profile = z.infer<typeof ProfileSchema>;
