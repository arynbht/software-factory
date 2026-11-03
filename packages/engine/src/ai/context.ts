// The context packer: assemble what the model sees for a task — the profile, the
// gap report, the control's rationale and references, and a size-capped selection of
// repo files chosen by the task. Secrets are kept out by both a path denylist and a
// content scan (see redact.ts). The list of included files is returned so the PR
// description can tell a reviewer exactly what the model was shown.

import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import type { ControlResult } from "../evaluate.js";
import { isSensitivePath, looksBinary, looksLikeSecret } from "./redact.js";

export interface PackedContext {
  /** The assembled context block to hand to the model. */
  text: string;
  /** Repo-relative paths actually included (for the PR description). */
  includedFiles: string[];
  /** Paths skipped because they were sensitive (name or content). */
  skippedSensitive: string[];
  /** True if the byte cap stopped us before every candidate file was included. */
  truncated: boolean;
  /** Rough token estimate (~4 bytes/token). */
  approxTokens: number;
}

export interface PackContextOptions {
  /** The task name (for the header). */
  task: string;
  /** Task-specific file globs (repo-relative). */
  globs?: string[] | undefined;
  /** The control this task satisfies, if any (rationale + references). */
  control?: Control | null | undefined;
  /** The audit results, used to describe the current gaps. */
  results?: ControlResult[] | undefined;
  /**
   * Extra pre-rendered Markdown sections to append before the repository files —
   * used to supply task-specific input the packer doesn't assemble itself (e.g. the
   * git history for the `changelog` task). Gathered by the caller and only for the
   * tasks that need it, so the other tasks' context stays lean.
   */
  extraSections?: string[] | undefined;
  /** Hard byte cap across included file contents (default 60 KB ≈ 15k tokens). */
  maxBytes?: number | undefined;
}

const DEFAULT_MAX_BYTES = 60_000;

/**
 * Render a compact architecture summary from `.factory/floorplan.json` (the deep-
 * audit model), or null when there is no floor plan / it's unreadable. Lists the
 * systems and their top subsystems, plus the cross-system connections — enough to
 * orient the model without blowing the context budget.
 */
async function architectureSection(ctx: AuditContext): Promise<string | null> {
  const raw = await ctx.readFile(".factory/floorplan.json").catch(() => null);
  if (!raw) return null;
  let model: {
    nodes?: { id: string; kind: string; title: string; parent?: string }[];
    edges?: { from: string; to: string; kind: string }[];
  };
  try {
    model = JSON.parse(raw) as typeof model;
  } catch {
    return null;
  }
  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const edges = Array.isArray(model.edges) ? model.edges : [];
  const systems = nodes.filter((n) => n.kind === "system");
  if (systems.length === 0) return null;

  const title = new Map(nodes.map((n) => [n.id, n.title] as const));
  const lines: string[] = ["## Architecture (from the deep-audit floor plan)"];
  for (const sys of systems.slice(0, 20)) {
    const children = nodes
      .filter((n) => n.parent === sys.id)
      .slice(0, 8)
      .map((c) => `${c.title} (${c.kind})`);
    lines.push(
      `- **${sys.title}**${children.length ? `: ${children.join(", ")}` : ""}`,
    );
  }
  const crossEdges = edges
    .filter((e) => e.from.startsWith("system:") && e.to.startsWith("system:"))
    .slice(0, 30);
  if (crossEdges.length > 0) {
    lines.push("", "Connections:");
    for (const e of crossEdges) {
      lines.push(
        `- ${title.get(e.from) ?? e.from} —${e.kind}→ ${title.get(e.to) ?? e.to}`,
      );
    }
  }
  return lines.join("\n");
}

/** Assemble the task context, enforcing the secret guards and the size cap. */
export async function packContext(
  ctx: AuditContext,
  options: PackContextOptions,
): Promise<PackedContext> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const sections: string[] = [];

  sections.push(`# Task: ${options.task}`);

  const profile = await ctx.profile().catch(() => null);
  if (profile) {
    sections.push(
      [
        "## Project profile",
        `- name: ${profile.name ?? "(unset)"}`,
        `- type: ${profile.type ?? "(unset)"}`,
        `- phase: ${profile.phase ?? "(unset)"}`,
        `- stack: ${(profile.stack ?? []).join(", ") || "(unset)"}`,
      ].join("\n"),
    );
  }

  // Architecture map from the deep-audit floor plan, when one has been built. This
  // grounds every AI task (ADR, C4, threat model, explain-gaps) in the repo's real
  // systems and how they connect, instead of only the files the task's globs pull.
  const archSection = await architectureSection(ctx);
  if (archSection) sections.push(archSection);

  if (options.control) {
    const refs = (options.control.references ?? [])
      .map((r) => `- ${r.name}: ${r.url}${r.section ? ` (${r.section})` : ""}`)
      .join("\n");
    sections.push(
      [
        `## Control: ${options.control.id} — ${options.control.title ?? ""}`,
        (options.control.rationale ?? "").trim(),
        refs ? `\nReferences:\n${refs}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (options.results && options.results.length > 0) {
    const gaps = options.results.filter(
      (r) => r.status === "fail" || r.status === "needs-evidence",
    );
    if (gaps.length > 0) {
      sections.push(
        [
          "## Current gaps (from the audit)",
          ...gaps.map((g) => `- ${g.controlId} (${g.status}): ${g.title}`),
        ].join("\n"),
      );
    }
  }

  // Task-specific pre-rendered sections (e.g. git history for the changelog task).
  for (const section of options.extraSections ?? []) {
    if (section.trim() !== "") sections.push(section);
  }

  // Repo files chosen by the task globs, secret-guarded and size-capped.
  const includedFiles: string[] = [];
  const skippedSensitive: string[] = [];
  const fileSections: string[] = [];
  let used = 0;
  let truncated = false;

  if (options.globs && options.globs.length > 0) {
    const matches = await ctx.glob(options.globs);
    // Stable order so the packed context (and its file list) is deterministic.
    matches.sort();

    for (const rel of matches) {
      if (isSensitivePath(rel)) {
        skippedSensitive.push(rel);
        continue;
      }
      const contents = await ctx.readFile(rel);
      if (contents === null) continue;
      // Skip binary files: a raw-binary secret would neither match a text regex
      // nor be caught by name, and binary is never useful model context anyway.
      if (looksBinary(contents) || looksLikeSecret(contents)) {
        skippedSensitive.push(rel);
        continue;
      }
      const block = `### ${rel}\n\`\`\`\n${contents}\n\`\`\``;
      if (used + block.length > maxBytes) {
        truncated = true;
        continue; // skip this one but keep checking for smaller files
      }
      used += block.length;
      includedFiles.push(rel);
      fileSections.push(block);
    }
  }

  if (fileSections.length > 0) {
    sections.push("## Repository files", ...fileSections);
  }

  const text = sections.join("\n\n");
  return {
    text,
    includedFiles,
    skippedSensitive,
    truncated,
    approxTokens: Math.ceil(text.length / 4),
  };
}
