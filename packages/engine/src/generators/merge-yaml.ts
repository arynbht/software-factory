import type { Control } from "@arynbht/factory-catalog";
import { parseDocument } from "yaml";

import type { AuditContext } from "../context.js";
import { deepEqual, tokenizePath } from "../detectors/path.js";
import { splitGlobs } from "../detectors/util.js";
import type { Change, Generator } from "./types.js";

function toPlain(node: unknown): unknown {
  return node && typeof node === "object" && "toJSON" in node
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

/**
 * Set a dot/bracket path to a value inside a YAML file, preserving the rest of the
 * document's formatting and comments (yaml Document round-trip). No-op if already
 * equal; creates the file if absent.
 */
export const mergeYamlGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "merge-yaml") return [];
  const { file, path, value } = control.fix;
  if (value === undefined) return [];

  const matches = await ctx.glob(splitGlobs(file));
  const target = matches[0] ?? file;
  const current = await ctx.readFile(target);
  const tokens = tokenizePath(path);

  const doc = parseDocument(current ?? "", { keepSourceTokens: true });
  if (current !== null) {
    const existing = toPlain(doc.getIn(tokens));
    if (existing !== undefined && deepEqual(existing, value)) return [];
  }

  doc.setIn(tokens, value);

  return [
    {
      type: "file",
      controlId: control.id,
      path: target,
      contents: doc.toString(),
      op: "merge",
    },
  ];
};
