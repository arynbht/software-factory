import type { Control } from "@arynbht/factory-catalog";
import { applyEdits, modify } from "jsonc-parser";

import type { AuditContext } from "../context.js";
import { deepEqual, getByPath, tokenizePath } from "../detectors/path.js";
import { splitGlobs } from "../detectors/util.js";
import type { Change, Generator } from "./types.js";

/**
 * Set a dot/bracket path to a value inside a JSON(C) file with a minimal,
 * formatting-preserving edit (jsonc-parser). No-op if already equal; creates the
 * file from `{}` if absent.
 */
export const mergeJsonGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "merge-json") return [];
  const { file, path, value } = control.fix;
  if (value === undefined) return [];

  const matches = await ctx.glob(splitGlobs(file));
  const target = matches[0] ?? file;
  const current = (await ctx.readFile(target)) ?? "{}\n";

  let parsed: unknown;
  try {
    parsed = JSON.parse(current === "" ? "{}" : current);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    const found = getByPath(parsed, path);
    if (found.found && deepEqual(found.value, value)) return [];
  }

  const edits = modify(current, tokenizePath(path), value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  if (edits.length === 0) return [];
  const next = applyEdits(current, edits);

  return [
    {
      type: "file",
      controlId: control.id,
      path: target,
      contents: next.endsWith("\n") ? next : `${next}\n`,
      op: "merge",
    },
  ];
};
