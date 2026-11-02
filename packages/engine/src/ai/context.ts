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
  /** Hard byte cap across included file contents (default 60 KB ≈ 15k tokens). */
  maxBytes?: number | undefined;
}

const DEFAULT_MAX_BYTES = 60_000;

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
