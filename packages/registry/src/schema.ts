// Skill manifests (`factory.skill.yml`) and the per-repo lockfile
// (`.factory/skills.lock`). A manifest is the router's only view of a skill; the
// lock is what travels with a repo.
import { z } from "zod";

export const SECTORS = [
  "ui",
  "motion",
  "api",
  "data",
  "infra",
  "security",
  "testing",
  "a11y",
  "perf",
  "docs",
  "product",
  "legal",
  "workflow",
  "observability",
] as const;
export type Sector = (typeof SECTORS)[number];

export const SKILL_PHASES = [
  "intake",
  "brief",
  "build",
  "polish",
  "prove",
  "review",
] as const;
export type SkillPhase = (typeof SKILL_PHASES)[number];

export const SKILL_TOOLS = ["none", "browser", "shell", "network"] as const;

const NAME = /^[a-z0-9][a-z0-9-]*$/;
/** `owner/repo` or `owner/repo/path/to/skill`. */
const SOURCE = /^[\w.-]+\/[\w.-]+(\/[\w.@-]+)*$/;
const PIN = /^[0-9a-f]{40}$/;
export const HASH = /^sha256:[0-9a-f]{64}$/;
const CONTROL_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

/** Licenses a skill may carry without a human's license review. */
export const OSI_ALLOWED = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
] as const;

const ReviewSchema = z.strictObject({
  reviewed_by: z.string().min(1),
  reviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "reviewed is YYYY-MM-DD"),
});

const ScanAllowSchema = ReviewSchema.extend({
  rule: z.string().min(1),
  file: z.string().min(1),
  match_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "sha256 of the matched line"),
  note: z.string().optional(),
});

export const ManifestSchema = z.strictObject({
  name: z.string().regex(NAME, "name is a kebab-case directory name"),
  source: z.string().regex(SOURCE, "source is owner/repo[/path]"),
  /** A fork in your org to fetch from when the source commit is gone. */
  mirror: z.string().regex(SOURCE, "mirror is owner/repo[/path]").optional(),
  pin: z.string().regex(PIN, "pin is a full 40-character commit sha"),
  hash: z.string().regex(HASH, "hash is sha256:<64 hex>"),
  license: z.string().min(1),
  scope: z.enum(["always", "task"]),
  sectors: z.array(z.enum(SECTORS)).min(1),
  phases: z.array(z.enum(SKILL_PHASES)).min(1),
  triggers: z
    .strictObject({
      paths: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
      flags: z.array(z.string()).default([]),
    })
    .default({ paths: [], keywords: [], flags: [] }),
  provides: z.array(z.string()).default([]),
  conflicts: z.array(z.string().regex(NAME)).default([]),
  requires: z.array(z.string().regex(NAME)).default([]),
  commands: z.array(z.string()).default([]),
  tokens: z.number().int().positive(),
  tools: z.array(z.enum(SKILL_TOOLS)).default(["none"]),
  tested_on: z.string().optional(),
  notes: z.string().optional(),
  /**
   * Scan findings a human reviewed and accepted (e.g. a security skill quoting
   * `curl | sh` as an example). Each binds to one exact line, and all of them
   * are ignored once the lock pins a different commit than `pin`: a changed
   * prompt gets re-reviewed. Never set by tooling.
   */
  scan_allow: z.array(ScanAllowSchema).default([]),
  /**
   * Required when `license` isn't on the OSI allow-list: a human's signed
   * review of the terms. Without it, sync refuses the skill.
   */
  license_review: ReviewSchema.extend({ note: z.string().min(1) }).optional(),
  /** Catalog controls this skill helps satisfy. Legal-sector skills need one. */
  controls: z.array(z.string().regex(CONTROL_ID)).default([]),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export const LockEntrySchema = z.strictObject({
  name: z.string().regex(NAME),
  source: z.string().regex(SOURCE),
  mirror: z.string().regex(SOURCE).optional(),
  pin: z.string().regex(PIN),
  hash: z.string().regex(HASH),
  scope: z.enum(["always", "task"]),
});

export const LockSchema = z.strictObject({
  version: z.literal(1),
  skills: z.array(LockEntrySchema).default([]),
});

export type LockEntry = z.infer<typeof LockEntrySchema>;
export type Lock = z.infer<typeof LockSchema>;

export interface ManifestIssue {
  name: string;
  message: string;
}

/**
 * Checks across a set of manifests: unique names, `conflicts`/`requires` only
 * name known manifests, conflicts are symmetric, and a skill never requires one
 * it conflicts with.
 */
export function validateManifestSet(
  manifests: readonly Manifest[],
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const byName = new Map<string, Manifest>();
  for (const m of manifests) {
    if (byName.has(m.name)) {
      issues.push({ name: m.name, message: "duplicate manifest name" });
    }
    byName.set(m.name, m);
  }
  for (const m of manifests) {
    if (m.sectors.includes("legal") && m.controls.length === 0) {
      issues.push({
        name: m.name,
        message:
          "a legal-sector skill must name the controls it helps satisfy (`controls:`)",
      });
    }
    for (const other of m.conflicts) {
      const target = byName.get(other);
      if (!target) {
        issues.push({
          name: m.name,
          message: `conflicts with unknown skill "${other}"`,
        });
      } else if (!target.conflicts.includes(m.name)) {
        issues.push({
          name: m.name,
          message: `conflicts with "${other}", but "${other}" doesn't list it back`,
        });
      }
    }
    for (const other of m.requires) {
      if (!byName.has(other)) {
        issues.push({
          name: m.name,
          message: `requires unknown skill "${other}"`,
        });
      } else if (m.conflicts.includes(other)) {
        issues.push({
          name: m.name,
          message: `both requires and conflicts with "${other}"`,
        });
      }
    }
  }
  return issues;
}

/**
 * Why sync must refuse this skill's license, or null. OSI licenses pass;
 * anything else (source-available, royalties, unknown) needs a human's
 * `license_review`.
 */
export function licenseProblem(m: Manifest): string | null {
  if ((OSI_ALLOWED as readonly string[]).includes(m.license)) return null;
  if (m.license_review) return null;
  return `license ${m.license} isn't on the OSI allow-list and has no license_review`;
}

/**
 * The reviewed scan exceptions that still apply: none once the lock pins a
 * different commit than the one the review was done against.
 */
export function activeAllows(
  m: Manifest,
  lockedPin: string,
): Manifest["scan_allow"] {
  return m.pin === lockedPin ? m.scan_allow : [];
}

/** Split `owner/repo/path/to/skill` into the repo and the path inside it. */
export function parseSource(source: string): { repo: string; path: string } {
  const [owner, repo, ...rest] = source.split("/");
  return { repo: `${owner}/${repo}`, path: rest.join("/") };
}
