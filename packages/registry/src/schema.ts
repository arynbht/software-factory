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

export const SKILL_PHASES = [
  "intake",
  "brief",
  "build",
  "polish",
  "prove",
  "review",
] as const;

export const SKILL_TOOLS = ["none", "browser", "shell", "network"] as const;

const NAME = /^[a-z0-9][a-z0-9-]*$/;
/** `owner/repo` or `owner/repo/path/to/skill`. */
const SOURCE = /^[\w.-]+\/[\w.-]+(\/[\w.@-]+)*$/;
const PIN = /^[0-9a-f]{40}$/;
export const HASH = /^sha256:[0-9a-f]{64}$/;

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
   * Scan rules a human has reviewed and accepted for this skill (e.g. a security
   * skill that quotes `curl | sh` as an example). Never set by tooling.
   */
  scan_allow: z.array(z.string()).default([]),
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

/** Split `owner/repo/path/to/skill` into the repo and the path inside it. */
export function parseSource(source: string): { repo: string; path: string } {
  const [owner, repo, ...rest] = source.split("/");
  return { repo: `${owner}/${repo}`, path: rest.join("/") };
}
