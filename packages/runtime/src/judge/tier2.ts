// Judge tier 2: a scoped AI review of a change (FACTORY_V2.md §8.3).
//
// Exactly three kinds of finding may block — a defect, a contract breach
// (AGENTS.md / CONSTRAINTS.md), or an unmet acceptance criterion. Anything
// else is a suggestion: collected, never a reason to request changes. Every
// blocking finding is re-checked in a fresh context for a concrete
// reproduction; without one it's downgraded to a suggestion.
//
// The model sees only what this module packs into the prompt: the diff (minus
// sensitive paths and anything secret-shaped) and the contract files from the
// base commit. The CLI transport runs locked down (no tools, empty cwd).
import {
  type AiClient,
  appendUsage,
  estimateCost,
  isSensitivePath,
  looksLikeSecret,
} from "@arynbht/factory-engine";
import picomatch from "picomatch";
import { type SimpleGit, simpleGit } from "simple-git";
import { z } from "zod";

import type { Card } from "../task/card.js";
import { isTestFile } from "./protected.js";
import { parseNameStatus } from "./tier1.js";

export const BLOCKING_KINDS = ["defect", "contract", "acceptance"] as const;
export const FINDING_KINDS = [...BLOCKING_KINDS, "suggestion"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Default judge model, deliberately not the drafting default (§14: independence). */
export const JUDGE_DEFAULT_MODEL = "claude-opus-5-5";
/** Max characters of diff packed into the prompt (~35k tokens). */
const DIFF_BUDGET = 400_000;

/** Machine-written files: reviewing them wastes the budget and finds nothing. */
const GENERATED = picomatch(
  [
    "**/dist/**",
    "**/*.min.js",
    "**/*.map",
    "**/pnpm-lock.yaml",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/bun.lock",
    "**/bun.lockb",
    "**/Cargo.lock",
    "**/poetry.lock",
    "**/uv.lock",
    "**/go.sum",
  ],
  { dot: true },
);

/** Review order when the budget is tight: source, then tests, then docs and config. */
function priority(path: string): number {
  if (isTestFile(path)) return 1;
  if (/\.(md|mdx|txt|ya?ml|json|toml|lock)$/i.test(path)) return 2;
  return 0;
}
/** Max blocking findings sent to the false-positive gate. */
const MAX_FP_CHECKS = 8;

const FindingSchema = z.object({
  kind: z.enum(FINDING_KINDS).catch("suggestion"),
  file: z.string().default(""),
  // A bad line or a missing title shouldn't throw away the whole review.
  line: z.number().int().nonnegative().nullable().default(null).catch(null),
  acceptance_id: z.string().nullable().optional(),
  title: z.string().min(1).catch("(untitled)"),
  detail: z.string().default(""),
  repro: z.string().default(""),
  fix: z.string().default(""),
});
export type Finding = z.infer<typeof FindingSchema> & {
  /** Set when the false-positive gate turned a blocking finding into a suggestion. */
  downgraded?: string | undefined;
};

const ReviewSchema = z.object({
  findings: z.array(FindingSchema).default([]),
  acceptance: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["met", "unmet", "unverified"]).catch("unverified"),
        note: z.string().default(""),
      }),
    )
    .default([]),
});

const GateSchema = z.object({
  reproducible: z.boolean(),
  repro: z.string().default(""),
  reason: z.string().default(""),
});

export interface PackedChange {
  diff: string;
  files: string[];
  omitted: { path: string; why: string }[];
  /** New-side line numbers that appear in the diff, per file (for inline comments). */
  lines: Map<string, Set<number>>;
  agents: string | null;
  constraints: string | null;
}

export interface Tier2Result {
  verdict: "approve" | "request-changes";
  blocking: Finding[];
  suggestions: Finding[];
  acceptance: z.infer<typeof ReviewSchema>["acceptance"];
  model: string;
  calls: number;
  packed: Omit<PackedChange, "diff">;
}

export interface Tier2Options {
  repoPath: string;
  /** The merge-base (or base commit) and the change's head commit. */
  base: string;
  head: string;
  ai: AiClient;
  model?: string | undefined;
  card?: Card | undefined;
  /** YYYY-MM-DD for the usage log; no log when omitted. */
  usageDate?: string | undefined;
  log?: ((line: string) => void) | undefined;
}

async function showAt(git: SimpleGit, rev: string, path: string) {
  try {
    return await git.show([`${rev}:${path}`]);
  } catch {
    return null;
  }
}

/**
 * The change as the reviewer sees it. Files at sensitive paths, or whose added
 * lines look like they hold a secret, are left out (and listed, so the review
 * says what it didn't see). The contract files come from the base commit: the
 * change can't rewrite the rules it's judged by.
 */
export async function packChange(
  repoPath: string,
  base: string,
  head: string,
): Promise<PackedChange> {
  const git = simpleGit(repoPath);
  const all = parseNameStatus(
    await git.raw(["diff", "--name-status", "-M", base, head]),
  );
  // Files the repo marks as generated (`linguist-generated` in .gitattributes).
  const marked = new Set<string>();
  if (all.length > 0) {
    const attrs = await git
      .raw([
        "check-attr",
        "linguist-generated",
        "--",
        ...all.map((e) => e.path),
      ])
      .catch(() => "");
    for (const line of attrs.split("\n")) {
      const m = /^(.*): linguist-generated: (set|true)$/.exec(line.trim());
      if (m?.[1]) marked.add(m[1]);
    }
  }
  const entries = all
    .map((entry, i) => ({ entry, i }))
    .sort(
      (a, b) => priority(a.entry.path) - priority(b.entry.path) || a.i - b.i,
    )
    .map(({ entry }) => entry);
  const omitted: PackedChange["omitted"] = [];
  const files: string[] = [];
  const lines = new Map<string, Set<number>>();
  let diff = "";
  for (const entry of entries) {
    if (isSensitivePath(entry.path)) {
      omitted.push({ path: entry.path, why: "sensitive path" });
      continue;
    }
    if (GENERATED(entry.path) || marked.has(entry.path)) {
      omitted.push({ path: entry.path, why: "generated" });
      continue;
    }
    const fileDiff = await git.raw([
      "diff",
      "-U5",
      "--no-color",
      "-M",
      base,
      head,
      "--",
      ...(entry.oldPath ? [entry.oldPath] : []),
      entry.path,
    ]);
    if (/^Binary files /m.test(fileDiff)) {
      omitted.push({ path: entry.path, why: "binary" });
      continue;
    }
    // Every body line is sent (removed and context lines too), so scan them all.
    const body = fileDiff
      .split("\n")
      .filter((l) => /^[+\- ]/.test(l) && !/^(\+\+\+|---) /.test(l))
      .join("\n");
    if (looksLikeSecret(body)) {
      omitted.push({ path: entry.path, why: "looks like it holds a secret" });
      continue;
    }
    if (diff.length + fileDiff.length > DIFF_BUDGET) {
      omitted.push({ path: entry.path, why: "over the review's size budget" });
      continue;
    }
    diff += fileDiff;
    files.push(entry.path);
    lines.set(entry.path, newSideLines(fileDiff));
  }
  return {
    diff,
    files,
    omitted,
    lines,
    agents: await showAt(git, base, "AGENTS.md"),
    constraints: await showAt(git, base, "CONSTRAINTS.md"),
  };
}

/** New-side line numbers covered by a file's hunks (added and context lines). */
export function newSideLines(fileDiff: string): Set<number> {
  const out = new Set<number>();
  let line = 0;
  let inHunk = false;
  for (const text of fileDiff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || text.startsWith("\\")) continue;
    if (text.startsWith("-")) continue;
    if (text.startsWith("+") || text.startsWith(" ")) out.add(line++);
  }
  return out;
}

const RUBRIC = `You are the judge in a software factory, reviewing one change (a diff) before a human merges it.

You may raise exactly three kinds of BLOCKING finding:
- "defect": a correctness bug, security issue, data loss, race, or unhandled failure path that this diff introduces or leaves reachable.
- "contract": the diff violates AGENTS.md, CONSTRAINTS.md, or a stated house pattern (quote the rule).
- "acceptance": an acceptance criterion on the task card is unmet or unverifiable from this change (give its id).

Everything else — style, naming, readability, "could be tighter", alternative designs, missing nice-to-haves, speculative risks — is a "suggestion". Suggestions never block.

Rules:
- Every blocking finding needs a concrete "repro": the input, state or steps that make the problem happen in THIS diff. If you can't write one, it is a suggestion.
- "line" is the line number in the new version of the file, from the diff's hunk headers. Use null if no single line applies.
- Don't report problems in code the diff didn't touch unless the diff makes them reachable.
- Be specific and brief. No praise, no summary of the change.

Reply with ONLY a JSON object, no prose and no code fence:
{"findings":[{"kind":"defect|contract|acceptance|suggestion","file":"path","line":12,"acceptance_id":"A1 or null","title":"one line","detail":"what is wrong and why","repro":"how to trigger it","fix":"the smallest change that fixes it"}],"acceptance":[{"id":"A1","status":"met|unmet|unverified","note":"short"}]}`;

const GATE = `You are checking one code-review finding before it can block a merge. Default to rejecting it.

Decide whether the finding is real and reproducible in THIS diff, and how. It is reproducible only if you can name concrete inputs, state or steps that trigger the problem given the code shown. Style, preference and speculative concerns are not reproducible.

Reply with ONLY a JSON object: {"reproducible": true|false, "repro": "exact steps, or empty", "reason": "one line"}`;

function reviewPrompt(packed: PackedChange, card?: Card): string {
  const parts: string[] = [];
  if (card) {
    parts.push(
      `## Task card ${card.id}: ${card.title}\n${card.description}\n\nAcceptance criteria:\n${card.acceptance.map((a) => `- ${a.id} (${a.verify}): ${a.text}`).join("\n")}` +
        (card.out_of_scope.length
          ? `\n\nOut of scope:\n${card.out_of_scope.map((o) => `- ${o}`).join("\n")}`
          : "") +
        (card.constraints.length
          ? `\n\nConstraints:\n${card.constraints.map((c) => `- ${c}`).join("\n")}`
          : ""),
    );
  }
  if (packed.agents)
    parts.push(`## AGENTS.md (the repo's contract)\n${packed.agents}`);
  if (packed.constraints)
    parts.push(`## CONSTRAINTS.md\n${packed.constraints}`);
  if (packed.omitted.length) {
    parts.push(
      `## Not shown to you\n${packed.omitted.map((o) => `- ${o.path}: ${o.why}`).join("\n")}`,
    );
  }
  parts.push(`## The diff\n${packed.diff || "(empty)"}`);
  return parts.join("\n\n");
}

/** The last JSON object in a reply (models sometimes add text around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidates = [fenced, text].filter((t): t is string => Boolean(t));
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }
  throw new Error("the reviewer did not reply with JSON");
}

/**
 * Run the review: one call for findings, then one fresh-context call per
 * blocking finding (up to a cap) to confirm it reproduces. Findings that fail
 * the gate, or exceed the cap, become suggestions.
 */
export async function runTier2(options: Tier2Options): Promise<Tier2Result> {
  const log = options.log ?? (() => undefined);
  const model = options.model ?? JUDGE_DEFAULT_MODEL;
  const packed = await packChange(options.repoPath, options.base, options.head);
  let calls = 0;
  const complete = async (system: string, prompt: string, task: string) => {
    calls++;
    const res = await options.ai.complete({
      system,
      prompt,
      model,
      maxTokens: 8000,
    });
    if (options.usageDate) {
      await appendUsage(options.repoPath, {
        date: options.usageDate,
        task,
        model: res.model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        costUsd: estimateCost(res.model, res.usage),
      }).catch(() => undefined);
    }
    return res.text;
  };

  log(`reviewing ${packed.files.length} file(s) with ${model}`);
  const review = ReviewSchema.parse(
    extractJson(
      await complete(
        RUBRIC,
        reviewPrompt(packed, options.card),
        "judge-review",
      ),
    ),
  );

  const blocking: Finding[] = [];
  const suggestions: Finding[] = [];
  let checked = 0;
  for (const finding of review.findings) {
    if (finding.kind === "suggestion") {
      suggestions.push(finding);
      continue;
    }
    // A finding about a file the reviewer wasn't shown can't be confirmed.
    if (finding.file && !packed.files.includes(finding.file)) {
      suggestions.push({
        ...finding,
        kind: "suggestion",
        downgraded: "names a file outside the diff",
      });
      continue;
    }
    if (checked >= MAX_FP_CHECKS) {
      suggestions.push({
        ...finding,
        kind: "suggestion",
        downgraded: "over the review's check budget",
      });
      continue;
    }
    log(`checking: ${finding.title}`);
    const fileDiff = finding.file
      ? (packed.diff
          .split(/^(?=diff --git )/m)
          .find((d) => d.includes(` b/${finding.file}\n`)) ?? packed.diff)
      : packed.diff;
    checked++;
    // A failed call is an error, not a verdict: it must never turn into an approval.
    const reply = await complete(
      GATE,
      `## Finding (${finding.kind})\n${JSON.stringify(finding, null, 2)}\n\n## The diff\n${fileDiff}`,
      "judge-fp-gate",
    );
    let gate: z.infer<typeof GateSchema>;
    try {
      gate = GateSchema.parse(extractJson(reply));
    } catch {
      gate = {
        reproducible: false,
        repro: "",
        reason: "the check didn't return a verdict",
      };
    }
    if (gate.reproducible && gate.repro.trim().length >= 20) {
      blocking.push({ ...finding, repro: gate.repro.trim() });
    } else {
      suggestions.push({
        ...finding,
        kind: "suggestion",
        downgraded: `no reproduction confirmed${gate.reason ? `: ${gate.reason}` : ""}`,
      });
    }
  }

  return {
    verdict: blocking.length > 0 ? "request-changes" : "approve",
    blocking,
    suggestions,
    acceptance: review.acceptance,
    model,
    calls,
    packed: {
      files: packed.files,
      omitted: packed.omitted,
      lines: packed.lines,
      agents: packed.agents,
      constraints: packed.constraints,
    },
  };
}

/** Marker in every review body, so later rounds can be counted. */
export const REVIEW_MARKER = "<!-- factory-judge-review";

/** The review as Markdown: blocking findings first, then one block of suggestions. */
export function renderReview(
  result: Tier2Result,
  round: number,
  verdict: "approve" | "request-changes" | "needs-human",
): string {
  const where = (f: Finding) =>
    f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
  const lines = [
    `${REVIEW_MARKER} round=${round} -->`,
    `### Factory judge · round ${round} · ${verdict === "approve" ? "approve" : verdict === "needs-human" ? "needs a human" : `${result.blocking.length} blocking`}`,
  ];
  if (verdict === "needs-human") {
    lines.push(
      "",
      "Two review rounds have run and blocking findings remain, so this goes to a person instead of another automated round.",
    );
  }
  if (result.blocking.length > 0) {
    lines.push("", "#### Blocking");
    for (const f of result.blocking) {
      lines.push(
        "",
        `**${f.kind}${f.acceptance_id ? ` (${f.acceptance_id})` : ""}: ${f.title}** ${where(f)}`,
        f.detail,
        `- **Repro:** ${f.repro}`,
        ...(f.fix ? [`- **Fix:** ${f.fix}`] : []),
      );
    }
  }
  if (result.acceptance.length > 0) {
    lines.push(
      "",
      "#### Acceptance",
      ...result.acceptance.map(
        (a) => `- ${a.id}: ${a.status}${a.note ? ` — ${a.note}` : ""}`,
      ),
    );
  }
  if (result.suggestions.length > 0) {
    lines.push(
      "",
      `<details><summary>${result.suggestions.length} suggestion(s), non-blocking</summary>`,
      "",
    );
    for (const f of result.suggestions) {
      lines.push(
        `- ${f.title} ${where(f)}${f.downgraded ? ` _(downgraded: ${f.downgraded})_` : ""}${f.fix ? ` — ${f.fix}` : ""}`,
      );
    }
    lines.push("", "</details>");
  }
  if (result.packed.omitted.length > 0) {
    lines.push(
      "",
      `_Not reviewed: ${result.packed.omitted.map((o) => `\`${o.path}\` (${o.why})`).join(", ")}._`,
    );
  }
  lines.push(
    "",
    `_${result.model} · ${result.calls} call(s) · Claude reviews, humans merge._`,
  );
  return lines.join("\n");
}
