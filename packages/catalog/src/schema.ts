// The control schema. Controls are YAML files validated against this at load time.
// A JSON Schema is generated from it (schema.gen.ts) for editor autocomplete.
import { z } from "zod";

import {
  EFFORTS,
  FLAG_KEYS,
  LANE_BY_KEY,
  LANE_KEYS,
  PHASE_KEYS,
  PROJECT_TYPES,
  SEVERITIES,
} from "./taxonomy.js";

/* -------------------------------------------------------------------------- */
/* Detector configs — one shape per detector type (M1).                        */
/* -------------------------------------------------------------------------- */

const glob = z.string().min(1);

const FileExistsSchema = z.object({
  type: z.literal("file-exists"),
  path: glob.describe("Glob; passes if at least one file matches."),
});

const FileMatchesSchema = z.object({
  type: z.literal("file-matches"),
  path: glob.describe(
    "Glob (may be `a|b|c`); files whose contents are searched.",
  ),
  pattern: z.string().min(1).describe("Regex matched against file contents."),
});

const FileJsonPathSchema = z.object({
  type: z.literal("file-json-path"),
  file: z.string().min(1),
  path: z
    .string()
    .min(1)
    .describe("Dot/bracket path, e.g. compilerOptions.strict."),
  equals: z
    .unknown()
    .optional()
    .describe("If set, the value at `path` must equal this."),
  exists: z
    .boolean()
    .optional()
    .describe(
      "Ignored when `equals` is set. `true` (default): pass if the path exists. `false`: pass only if the path is absent in every matched file.",
    ),
});

const FileYamlPathSchema = z.object({
  type: z.literal("file-yaml-path"),
  file: z.string().min(1),
  path: z.string().min(1).describe("Dot/bracket path into the YAML document."),
  equals: z.unknown().optional(),
  exists: z
    .boolean()
    .optional()
    .describe(
      "Ignored when `equals` is set. `true` (default): pass if the path exists. `false`: pass only if the path is absent in every matched file.",
    ),
});

const GithubApiCheckSchema = z.enum([
  "branch-protection",
  "required-status-checks",
  "required-pull-request",
  "dependabot-security-updates",
  "vulnerability-alerts",
  "secret-scanning",
  "secret-scanning-push-protection",
  "default-branch",
  "visibility",
  "actions-permissions",
]);

const GithubApiSchema = z.object({
  type: z.literal("github-api"),
  check: GithubApiCheckSchema.describe(
    "Named repository check to query via the API.",
  ),
  equals: z.unknown().optional(),
});

const CommandSchema = z.object({
  type: z.literal("command"),
  run: z.string().min(1).describe("Command line to execute in the repo root."),
  expectExitCode: z
    .number()
    .int()
    .optional()
    .describe("Pass only on this exit code (default 0)."),
  jsonPath: z.string().optional().describe("Path into JSON stdout to compare."),
  equals: z.unknown().optional(),
});

const ScorecardSchema = z.object({
  type: z.literal("scorecard"),
  check: z
    .string()
    .min(1)
    .describe("OpenSSF Scorecard check name, e.g. Token-Permissions."),
  min: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe("Minimum acceptable check score (0-10)."),
});

const ManualSchema = z.object({
  type: z.literal("manual"),
});

export const DetectorConfigSchema = z.discriminatedUnion("type", [
  FileExistsSchema,
  FileMatchesSchema,
  FileJsonPathSchema,
  FileYamlPathSchema,
  GithubApiSchema,
  CommandSchema,
  ScorecardSchema,
  ManualSchema,
]);

export type DetectorConfig = z.infer<typeof DetectorConfigSchema>;
export type DetectorType = DetectorConfig["type"];

/* -------------------------------------------------------------------------- */
/* Fix configs — parsed in M1, consumed by generators in M3.                   */
/* -------------------------------------------------------------------------- */

export const FixConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("template"), template: z.string().min(1) }),
  z.object({
    type: z.literal("merge-yaml"),
    file: z.string().min(1),
    path: z.string().min(1),
    value: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("merge-json"),
    file: z.string().min(1),
    path: z.string().min(1),
    value: z.unknown().optional(),
  }),
  z.object({ type: z.literal("github-setting"), setting: z.string().min(1) }),
  z.object({ type: z.literal("command"), run: z.string().min(1) }),
  z.object({ type: z.literal("claude"), task: z.string().min(1) }),
]);

export type FixConfig = z.infer<typeof FixConfigSchema>;

/* -------------------------------------------------------------------------- */
/* Applicability predicate — parsed in M1, evaluated in M2.                     */
/* -------------------------------------------------------------------------- */

export const PredicateSchema = z.object({
  get all() {
    return z.array(PredicateSchema).optional();
  },
  get any() {
    return z.array(PredicateSchema).optional();
  },
  get not() {
    return PredicateSchema.optional();
  },
  flag: z.enum(FLAG_KEYS).optional(),
  type: z.enum(PROJECT_TYPES).optional(),
  stack: z.string().optional(),
  "phase-at-least": z.enum(PHASE_KEYS).optional(),
});

export type Predicate = z.infer<typeof PredicateSchema>;

/* -------------------------------------------------------------------------- */
/* References & the control itself.                                            */
/* -------------------------------------------------------------------------- */

export const ReferenceSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  section: z.string().optional(),
});

export const EVIDENCE_LEVELS = ["none", "optional", "required"] as const;

/**
 * The canonical control-id shape (`lane.topic.name`, lowercase kebab-case). Shared
 * so anything that references a control id — waivers, evidence — can validate the
 * reference and reject arbitrary strings (which could otherwise carry Markdown into
 * a posted PR/issue comment).
 */
export const CONTROL_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

export const ControlObjectSchema = z.strictObject({
  id: z
    .string()
    .regex(
      CONTROL_ID_PATTERN,
      "id must be lane.topic.name in lowercase kebab-case",
    ),
  title: z.string().min(1),
  lane: z.enum(LANE_KEYS),
  phase: z.enum(PHASE_KEYS),
  severity: z.enum(SEVERITIES),
  effort: z.enum(EFFORTS).optional(),
  applies: PredicateSchema.optional(),
  detect: z
    .array(DetectorConfigSchema)
    .min(1, "a control needs at least one detector"),
  evidence: z.enum(EVIDENCE_LEVELS).default("none"),
  fix: FixConfigSchema.optional(),
  references: z
    .array(ReferenceSchema)
    .min(1, "every control must cite at least one reference"),
  rationale: z.string().min(1, "every control must have a rationale"),
  deprecated: z.boolean().optional(),
  "replaced-by": z.string().optional(),
});

/**
 * The full control schema: the object shape plus cross-field checks. Use this to
 * validate loaded controls.
 */
export const ControlSchema = ControlObjectSchema.refine(
  (control) => control.id.split(".")[0] === LANE_BY_KEY[control.lane].code,
  {
    message:
      "control id prefix must be the lane's code (see LANES in taxonomy.ts)",
    path: ["id"],
  },
).refine(
  // A merge fix with no `value` has nothing to merge — the generator silently
  // produces no change, so such a fix is misleading and rejected at load time.
  (control) =>
    !(
      (control.fix?.type === "merge-yaml" ||
        control.fix?.type === "merge-json") &&
      control.fix.value === undefined
    ),
  {
    message: "a merge-yaml/merge-json fix must specify a 'value' to merge",
    path: ["fix", "value"],
  },
);

export type Control = z.infer<typeof ControlSchema>;
