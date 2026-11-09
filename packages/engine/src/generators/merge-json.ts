import type { Control } from "@arynbht/factory-catalog";
import { applyEdits, modify } from "jsonc-parser";

import type { AuditContext } from "../context.js";
import { deepEqual, getByPath, tokenizePath } from "../detectors/path.js";
import { splitGlobs } from "../detectors/util.js";
import type { Change, Generator } from "./types.js";

/**
 * Set a dot/bracket path to a value inside a JSON(C) file with a minimal,
 * formatting-preserving edit (jsonc-parser). No-op if already equal.
 *
 * Never overwrites: when the path already holds a *different* value, the human's
 * value wins and the merged result is offered as `<file>.factory-suggested`.
 *
 * An absent target is a no-op (creating a structured file from a single fragment
 * is normally a `template` fix's job — e.g. `package.json` in a non-Node repo),
 * unless the fix sets `createIfMissing`, in which case a file holding just this
 * value is created (a minimal strict `tsconfig.json`).
 */
export const mergeJsonGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "merge-json") return [];
  const { file, path, value, createIfMissing } = control.fix;
  if (value === undefined) return [];

  const matches = await ctx.glob(splitGlobs(file));
  const target = matches[0] ?? splitGlobs(file)[0] ?? file;
  const current = await ctx.readFile(target);
  if (current === null) {
    if (!createIfMissing) return [];
    const edits = modify("{}", tokenizePath(path), value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    });
    return [
      {
        type: "file",
        controlId: control.id,
        path: target,
        contents: `${applyEdits("{}", edits)}\n`,
        op: "create",
      },
    ];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(current === "" ? "{}" : current);
  } catch {
    parsed = undefined;
  }
  let conflict = false;
  if (parsed !== undefined) {
    const found = getByPath(parsed, path);
    if (found.found && deepEqual(found.value, value)) return [];
    conflict = found.found;
  }

  // Preserve the file's existing line ending. Forcing "\n" on a CRLF-checked-out
  // file leaves it mixed-EOL and produces a whole-file diff on Windows.
  const eol = /\r\n/.test(current) ? "\r\n" : "\n";
  const edits = modify(current, tokenizePath(path), value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol },
  });
  if (edits.length === 0) return [];
  const next = applyEdits(current, edits);
  const contents = next.endsWith("\n") ? next : `${next}${eol}`;

  if (conflict) {
    return [
      {
        type: "file",
        controlId: control.id,
        path: target,
        contents,
        op: "suggest",
        reason: `${target} already sets ${path} to a different value`,
      },
    ];
  }
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
