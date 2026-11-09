import type { Control } from "@arynbht/factory-catalog";
import {
  type Document,
  isSeq,
  parseDocument,
  stringify,
  type YAMLSeq,
} from "yaml";

import type { AuditContext } from "../context.js";
import { deepEqual, tokenizePath } from "../detectors/path.js";
import { splitGlobs } from "../detectors/util.js";
import { detectStacks, templateStacks } from "../stack.js";
import type { Change, Generator } from "./types.js";

function toPlain(node: unknown): unknown {
  return node && typeof node === "object" && "toJSON" in node
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

/**
 * Resolve the merge value for the audited repo. A merge-yaml fix may carry a
 * `byStack` map; the entry for the first detected stack that has one is used,
 * otherwise the plain `value`. With `byStack` but no matching stack and no
 * `value`, this is `undefined` (a no-op) — the factory does not guess a stack.
 */
async function resolveValue(
  ctx: AuditContext,
  fix: Extract<Control["fix"], { type: "merge-yaml" }>,
): Promise<unknown> {
  const byStack = fix.byStack;
  if (byStack) {
    const stack = templateStacks(await detectStacks(ctx)).find(
      (s) => byStack[s] !== undefined,
    );
    if (stack) return byStack[stack];
  }
  return fix.value;
}

/** Job names preferred, in order, when several jobs could be "the CI job". */
const PREFERRED_JOBS = ["ci", "build", "test"];

type JobResolution =
  { ok: true; tokens: string[] } | { ok: false; reason: string };

/**
 * Catalog fixes name the CI job `jobs.ci`, matching the factory's own template.
 * Real workflows name it anything, so when `jobs.<name>` is absent, find the job
 * that builds the code instead: the one job with a checkout step, or — among
 * several — the first of `ci`, `build`, `test`. Anything else is ambiguous, and
 * the caller writes a suggestion rather than inventing a job (an invented job
 * with only `steps` is an invalid workflow).
 */
function resolveJob(doc: Document, tokens: string[]): JobResolution {
  if (tokens[0] !== "jobs" || tokens.length < 3) return { ok: true, tokens };
  const jobs = toPlain(doc.get("jobs")) as Record<string, unknown> | undefined;
  if (!jobs || typeof jobs !== "object") {
    return { ok: false, reason: "the workflow has no jobs" };
  }
  const named = tokens[1] as string;
  if (named in jobs) return { ok: true, tokens };

  const candidates = Object.entries(jobs)
    .filter(([, job]) => {
      const steps = (job as { steps?: unknown } | null)?.steps;
      return (
        Array.isArray(steps) &&
        steps.some((step) =>
          String((step as { uses?: unknown } | null)?.uses ?? "").startsWith(
            "actions/checkout",
          ),
        )
      );
    })
    .map(([name]) => name);

  const pick =
    candidates.length === 1
      ? candidates[0]
      : PREFERRED_JOBS.find((n) => candidates.includes(n));
  if (pick) return { ok: true, tokens: ["jobs", pick, ...tokens.slice(2)] };
  return {
    ok: false,
    reason:
      candidates.length === 0
        ? "no job in the workflow checks out the code"
        : `several jobs could take this step (${candidates.join(", ")})`,
  };
}

/**
 * append-if-missing: treat the node at `tokens` as a sequence and append each item
 * in `values` whose `dedupeKey` field is not already present among the existing
 * items. Preserves every existing item (and its comments/formatting) — unlike
 * `setIn`, which would replace the whole sequence. Returns whether anything was
 * appended, or `null` when the node is absent or not a sequence (the caller
 * suggests instead of guessing where the items belong).
 */
function appendIfMissing(
  doc: Document,
  tokens: string[],
  values: unknown[],
  dedupeKey: string,
): boolean | null {
  const seq = doc.getIn(tokens, true);
  if (!isSeq(seq)) return null;

  const existingKeys = new Set<string>();
  for (const item of seq.items) {
    const plain = toPlain(item) as Record<string, unknown> | null;
    const key = plain?.[dedupeKey];
    if (typeof key === "string") existingKeys.add(key);
  }

  let changed = false;
  for (const value of values) {
    const key = (value as Record<string, unknown>)[dedupeKey];
    if (typeof key === "string" && existingKeys.has(key)) continue;
    (seq as YAMLSeq).add(doc.createNode(value));
    if (typeof key === "string") existingKeys.add(key);
    changed = true;
  }
  return changed;
}

/**
 * Merge a value into a YAML file, preserving the rest of the document's formatting
 * and comments (yaml Document round-trip). Two strategies:
 *
 * - `set` (default): set a dot/bracket path to `value` (replacing that node).
 * - `append-if-missing`: treat the node at `path` as an array and append `value`
 *   (a single item or a list of items) only when no existing item matches
 *   `dedupeKey` — so a single CI step is added without clobbering its siblings.
 *
 * No-op if the resolved change is already present. A merge only ever edits an
 * existing file — it never fabricates one (which would produce an incomplete,
 * invalid workflow), so merging into an absent target is a safe no-op; use a
 * `template` fix to create the file first.
 */
export const mergeYamlGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "merge-yaml") return [];
  const { file, path } = control.fix;
  const value = await resolveValue(ctx, control.fix);
  if (value === undefined) return [];

  const matches = await ctx.glob(splitGlobs(file));
  const target = matches[0] ?? file;
  const current = await ctx.readFile(target);
  if (current === null) return [];

  // A leading BOM is stripped by the parser; remember it so the round-trip keeps
  // the file byte-identical away from the change (#59).
  const hadBom = current.charCodeAt(0) === 0xfeff;

  const doc = parseDocument(current, { keepSourceTokens: true });
  const suggest = (reason: string): Change[] => [
    {
      type: "file",
      controlId: control.id,
      path: target,
      op: "suggest",
      reason: `${target}: ${reason}`,
      contents:
        `# factory: ${reason}, so this was not merged automatically.\n` +
        `# Add the following at \`${path}\` in ${target} (in the job that builds\n` +
        `# and tests the code), then delete this file.\n` +
        stringify(value),
    },
  ];

  const job = resolveJob(doc, tokenizePath(path));
  if (!job.ok) return suggest(job.reason);
  const tokens = job.tokens;

  let changed: boolean;
  if (control.fix.mergeStrategy === "append-if-missing") {
    // The schema guarantees `dedupeKey` is set for this strategy.
    const dedupeKey = control.fix.dedupeKey as string;
    const values = Array.isArray(value) ? value : [value];
    const appended = appendIfMissing(doc, tokens, values, dedupeKey);
    if (appended === null) {
      return suggest(`\`${tokens.join(".")}\` is not a list of steps`);
    }
    changed = appended;
  } else {
    const existing = toPlain(doc.getIn(tokens));
    if (existing !== undefined && deepEqual(existing, value)) return [];
    doc.setIn(tokens, value);
    changed = true;
  }

  if (!changed) return [];

  // `flowCollectionPadding: false` keeps untouched flow collections verbatim
  // (`[main]`, not `[ main ]`); restore any leading BOM the parser dropped (#59).
  const body = doc.toString({ flowCollectionPadding: false });
  const contents = hadBom ? `\uFEFF${body}` : body;

  return [
    {
      type: "file",
      controlId: control.id,
      path: target,
      contents,
      op: "merge",
    },
  ];
};
