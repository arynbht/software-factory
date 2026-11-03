import type { Control } from "@arynbht/factory-catalog";
import { type Document, isSeq, parseDocument, type YAMLSeq } from "yaml";

import type { AuditContext } from "../context.js";
import { deepEqual, tokenizePath } from "../detectors/path.js";
import { splitGlobs } from "../detectors/util.js";
import { pickStack } from "./template.js";
import type { Change, Generator } from "./types.js";

function toPlain(node: unknown): unknown {
  return node && typeof node === "object" && "toJSON" in node
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

/**
 * Resolve the merge value for the audited repo's stack. A merge-yaml fix may carry
 * a `byStack` map (node/python); when it has an entry for the repo's stack that
 * fragment is used, otherwise the plain `value` is. Returns `undefined` only when
 * nothing applies (a no-op) — the schema guarantees at least one of the two exists.
 */
async function resolveValue(
  ctx: AuditContext,
  fix: Extract<Control["fix"], { type: "merge-yaml" }>,
): Promise<unknown> {
  if (fix.byStack) {
    const profile = await ctx.profile().catch(() => null);
    const stack = pickStack(profile?.stack ?? []);
    const forStack = fix.byStack[stack];
    if (forStack !== undefined) return forStack;
  }
  return fix.value;
}

/**
 * append-if-missing: treat the node at `tokens` as a sequence and append each item
 * in `values` whose `dedupeKey` field is not already present among the existing
 * items. Preserves every existing item (and its comments/formatting) — unlike
 * `setIn`, which would replace the whole sequence. Returns true if anything was
 * appended. If the path is absent or not a sequence, the sequence is created/reset
 * to the items (a safe fallback: the steps list was missing).
 */
function appendIfMissing(
  doc: Document,
  tokens: string[],
  values: unknown[],
  dedupeKey: string,
): boolean {
  const node = doc.getIn(tokens, true);
  let seq: YAMLSeq;
  if (isSeq(node)) {
    seq = node;
  } else {
    seq = doc.createNode([]) as YAMLSeq;
    doc.setIn(tokens, seq);
  }

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
    seq.add(doc.createNode(value));
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
  const tokens = tokenizePath(path);

  // A leading BOM is stripped by the parser; remember it so the round-trip keeps
  // the file byte-identical away from the change (#59).
  const hadBom = current.charCodeAt(0) === 0xfeff;

  const doc = parseDocument(current, { keepSourceTokens: true });

  let changed: boolean;
  if (control.fix.mergeStrategy === "append-if-missing") {
    // The schema guarantees `dedupeKey` is set for this strategy.
    const dedupeKey = control.fix.dedupeKey as string;
    const values = Array.isArray(value) ? value : [value];
    changed = appendIfMissing(doc, tokens, values, dedupeKey);
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
