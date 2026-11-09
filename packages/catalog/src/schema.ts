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

const FileExistsSchema = z.strictObject({
  type: z.literal("file-exists"),
  path: glob.describe("Glob; passes if at least one file matches."),
  exclude: glob
    .optional()
    .describe(
      "Glob (may be `a|b|c`) of paths that do NOT count as a match, e.g. the factory's own workflow. Files matching `exclude` are removed before the pass/fail decision.",
    ),
});

const FileMatchesSchema = z.strictObject({
  type: z.literal("file-matches"),
  path: glob.describe(
    "Glob (may be `a|b|c`); files whose contents are searched.",
  ),
  pattern: z.string().min(1).describe("Regex matched against file contents."),
  absent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Regex that must NOT match in the file that matched `pattern` — e.g. a template placeholder such as `@OWNER`, so an unfilled scaffold does not pass.",
    ),
});

const FileJsonPathSchema = z.strictObject({
  type: z.literal("file-json-path"),
  file: z.string().min(1),
  path: z
    .string()
    .min(1)
    .describe("Dot/bracket path, e.g. compilerOptions.strict."),
  min: z
    .number()
    .optional()
    .describe(
      "If set, the value at `path` must be a number at least this large (e.g. a coverage percentage).",
    ),
  matches: z
    .string()
    .min(1)
    .optional()
    .describe("Regex the value(s) at `path` must match (as strings)."),
  all: z
    .boolean()
    .optional()
    .describe(
      "With `matches`/`min`: every value at `path` must satisfy it (default: any one). `path` may use `*` wildcards, e.g. jobs.*.steps[*].uses.",
    ),
  exclude: glob
    .optional()
    .describe(
      "Glob (may be `a|b|c`) of files that never count, e.g. the factory's own workflow.",
    ),
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

const FileYamlPathSchema = z.strictObject({
  type: z.literal("file-yaml-path"),
  file: z.string().min(1),
  path: z.string().min(1).describe("Dot/bracket path into the YAML document."),
  min: z.number().optional().describe("Minimum for a numeric value."),
  matches: z
    .string()
    .min(1)
    .optional()
    .describe("Regex the value(s) at `path` must match (as strings)."),
  all: z
    .boolean()
    .optional()
    .describe(
      "With `matches`/`min`: every value at `path` must satisfy it (default: any one). `path` may use `*` wildcards, e.g. jobs.*.steps[*].uses.",
    ),
  exclude: glob
    .optional()
    .describe(
      "Glob (may be `a|b|c`) of files that never count, e.g. the factory's own workflow.",
    ),

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

const GithubApiSchema = z.strictObject({
  type: z.literal("github-api"),
  check: GithubApiCheckSchema.describe(
    "Named repository check to query via the API.",
  ),
  equals: z.unknown().optional(),
});

const StackCommandsSchema = z
  .strictObject({
    node: z.string().min(1).optional(),
    python: z.string().min(1).optional(),
    go: z.string().min(1).optional(),
    rust: z.string().min(1).optional(),
  })
  .describe(
    "Per-stack command lines. Each detected stack with an entry runs, and all must pass.",
  );

const CommandSchema = z.strictObject({
  type: z.literal("command"),
  run: z
    .string()
    .min(1)
    .optional()
    .describe("Command line to execute in the repo root."),
  byStack: StackCommandsSchema.optional(),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Seconds before the command is killed and reported as skip (default 60).",
    ),
  expectExitCode: z
    .number()
    .int()
    .optional()
    .describe("Pass only on this exit code (default 0)."),
  jsonPath: z.string().optional().describe("Path into JSON stdout to compare."),
  equals: z.unknown().optional(),
});

const ScorecardSchema = z.strictObject({
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

const ManualSchema = z.strictObject({
  type: z.literal("manual"),
});

const ReviewedSchema = z.strictObject({
  type: z.literal("reviewed"),
  path: glob.describe(
    "Glob (may be `a|b|c`). Passes when a matching file either was written by a human (no `factory:generated` header) or carries a filled `reviewed-by:` line.",
  ),
});

/** The automated detectors — everything but `manual` and the `any-of` combinator. */
const LeafDetectorSchema = z.discriminatedUnion("type", [
  FileExistsSchema,
  FileMatchesSchema,
  FileJsonPathSchema,
  FileYamlPathSchema,
  GithubApiSchema,
  CommandSchema,
  ScorecardSchema,
  ReviewedSchema,
]);

const AnyOfSchema = z.strictObject({
  type: z.literal("any-of"),
  detect: z
    .array(LeafDetectorSchema)
    .min(2, "any-of needs at least two alternatives")
    .describe(
      "Passes if any alternative passes. For controls one stack satisfies one way and another stack another way (eslint vs ruff vs golangci).",
    ),
});

export const DetectorConfigSchema = z.discriminatedUnion("type", [
  FileExistsSchema,
  FileMatchesSchema,
  FileJsonPathSchema,
  FileYamlPathSchema,
  GithubApiSchema,
  CommandSchema,
  ScorecardSchema,
  ReviewedSchema,
  ManualSchema,
  AnyOfSchema,
]);

export type DetectorConfig = z.infer<typeof DetectorConfigSchema>;
export type DetectorType = DetectorConfig["type"];

/* -------------------------------------------------------------------------- */
/* Fix configs — parsed in M1, consumed by generators in M3.                   */
/* -------------------------------------------------------------------------- */

/**
 * Per-stack override for a merge value. The generator resolves the audited repo's
 * detected stacks and, when a matching entry is present, appends/sets that
 * fragment instead of the default `value` — so one control can carry a `pytest`
 * step for Python repos and an `npm test` step for Node repos.
 */
const ByStackSchema = z
  .strictObject({
    node: z.unknown().optional(),
    python: z.unknown().optional(),
    go: z.unknown().optional(),
    rust: z.unknown().optional(),
  })
  .describe(
    "Per-stack value overrides (node/python/go/rust); falls back to `value`.",
  );

const ByStackCommandSchema = z
  .strictObject({
    node: z.string().min(1).optional(),
    python: z.string().min(1).optional(),
    go: z.string().min(1).optional(),
    rust: z.string().min(1).optional(),
  })
  .describe("Per-stack command lines; falls back to `run`.");

export const FixConfigSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("template"), template: z.string().min(1) }),
  z.strictObject({
    type: z.literal("merge-yaml"),
    file: z.string().min(1),
    path: z.string().min(1),
    value: z.unknown().optional(),
    byStack: ByStackSchema.optional(),
    mergeStrategy: z
      .enum(["set", "append-if-missing"])
      .optional()
      .describe(
        "`set` (default) replaces the node at `path`. `append-if-missing` treats the node at `path` as an array and appends `value` only if no existing item matches `dedupeKey`.",
      ),
    dedupeKey: z
      .string()
      .min(1)
      .optional()
      .describe(
        "For append-if-missing: the item field used to detect a duplicate (e.g. `uses` or `name`). An item is skipped if an existing item shares this key's value.",
      ),
  }),
  z.strictObject({
    type: z.literal("merge-json"),
    file: z.string().min(1),
    path: z.string().min(1),
    value: z.unknown().optional(),
    createIfMissing: z
      .boolean()
      .optional()
      .describe(
        "When the target file is absent, create it holding just this value (e.g. a minimal strict tsconfig.json). Default: absent target is a no-op.",
      ),
  }),
  z.strictObject({
    type: z.literal("github-setting"),
    setting: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("command"),
    run: z.string().min(1).optional(),
    byStack: ByStackCommandSchema.optional(),
  }),
  z.strictObject({ type: z.literal("claude"), task: z.string().min(1) }),
]);

export type FixConfig = z.infer<typeof FixConfigSchema>;

/* -------------------------------------------------------------------------- */
/* Applicability predicate — parsed in M1, evaluated in M2.                     */
/* -------------------------------------------------------------------------- */

export const PredicateSchema = z.strictObject({
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
  file: glob
    .optional()
    .describe(
      "Glob (may be `a|b|c`); holds when at least one file in the repo matches.",
    ),
});

export type Predicate = z.infer<typeof PredicateSchema>;

/* -------------------------------------------------------------------------- */
/* References & the control itself.                                            */
/* -------------------------------------------------------------------------- */

export const ReferenceSchema = z.strictObject({
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
  "valid-for": z
    .string()
    .regex(/^\d+\s*[dwy]?$/, "valid-for is a duration like 365d, 26w or 1y")
    .optional()
    .describe(
      "How long evidence for this control stays valid when the entry doesn't say (e.g. 365d for a threat model).",
    ),
  managed: z
    .boolean()
    .optional()
    .describe(
      "The factory owns the files this control's fix writes and may rewrite them even after a human edit (only for factory state, never project files).",
    ),
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
).superRefine((control, ctx) => {
  for (const [i, d] of control.detect.entries()) {
    const leaves = d.type === "any-of" ? d.detect : [d];
    for (const leaf of leaves) {
      if (leaf.type === "command" && leaf.run === undefined && !leaf.byStack) {
        ctx.addIssue({
          code: "custom",
          message: "a command detector must specify 'run' (or 'byStack')",
          path: ["detect", i],
        });
      }
    }
  }

  // Claude drafts, humans sign: a Claude-written file may satisfy a control only
  // once someone has reviewed it — via evidence, or a `reviewed` detector that
  // reads the draft's `reviewed-by:` line.
  if (
    control.fix?.type === "claude" &&
    control.evidence !== "required" &&
    !control.detect.some((d) => d.type === "reviewed")
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "a control fixed by Claude needs `evidence: required` or a `reviewed` detector",
      path: ["fix"],
    });
  }

  const fix = control.fix;
  if (fix?.type === "command" && fix.run === undefined && !fix.byStack) {
    ctx.addIssue({
      code: "custom",
      message: "a command fix must specify 'run' (or 'byStack')",
      path: ["fix", "run"],
    });
  }
  if (fix?.type !== "merge-yaml" && fix?.type !== "merge-json") return;

  // A merge fix must carry something to merge. `value` is the default; a
  // merge-yaml fix may instead (or additionally) supply per-stack fragments via
  // `byStack`. A fix with neither is a silent no-op and rejected at load time.
  const hasByStack =
    fix.type === "merge-yaml" &&
    fix.byStack !== undefined &&
    Object.values(fix.byStack).some((v) => v !== undefined);
  if (fix.value === undefined && !hasByStack) {
    ctx.addIssue({
      code: "custom",
      message:
        "a merge-yaml/merge-json fix must specify a 'value' (or 'byStack') to merge",
      path: ["fix", "value"],
    });
  }

  // append-if-missing dedups array items by a field; without a `dedupeKey` it
  // can't tell a duplicate from a new item, so it would append on every run.
  if (
    fix.type === "merge-yaml" &&
    fix.mergeStrategy === "append-if-missing" &&
    fix.dedupeKey === undefined
  ) {
    ctx.addIssue({
      code: "custom",
      message: "append-if-missing requires a 'dedupeKey' to dedupe array items",
      path: ["fix", "dedupeKey"],
    });
  }
});

export type Control = z.infer<typeof ControlSchema>;
