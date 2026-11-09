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

/**
 * Who the project belongs to, read by templates (LICENSE, CODEOWNERS, SECURITY.md)
 * so no scaffold ships a placeholder like `@OWNER` or `security@example.com`.
 */
const ProjectSchema = z
  .strictObject({
    /** SPDX license id, e.g. MIT or Apache-2.0. */
    license: z.string().min(1).optional(),
    /** GitHub handle (`@user` or `@org/team`) that owns the code. */
    owner: z.string().min(1).optional(),
    /** Copyright holder; defaults to the project name. */
    "copyright-holder": z.string().min(1).optional(),
    /** Where to report vulnerabilities: an email or a URL. */
    "security-contact": z.string().min(1).optional(),
  })
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
  project: ProjectSchema,
  ai: z
    .strictObject({
      /** Model for drafting and agent work. */
      model: z.string().min(1).optional(),
      /** Model for the judge's review; defaults to a different one from `model`. */
      judge_model: z.string().min(1).optional(),
    })
    .optional(),
  quality: z
    .strictObject({
      /**
       * Minimum line coverage (%). Unset: the baseline the factory recorded at
       * the first measured run (`.factory/quality.json`), which only ratchets up.
       */
      coverage: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
