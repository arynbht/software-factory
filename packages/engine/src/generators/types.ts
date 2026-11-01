import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";

/**
 * A proposed change produced by a generator.
 * - `file` with op `create`: a whole file the factory owns — written only if it is
 *   absent or factory-managed-and-unchanged (never clobbers a human's file).
 * - `file` with op `merge`: contents are the already-merged result of a structural
 *   edit, so writing them is a minimal change that preserves the human's content.
 * - `effect`: a non-file action (a GitHub setting, an installer) with a summary and
 *   a thunk run only in write mode.
 */
export type Change =
  | {
      type: "file";
      controlId: string;
      path: string;
      contents: string;
      op: "create" | "merge";
    }
  | {
      type: "effect";
      controlId: string;
      summary: string;
      run: () => Promise<void>;
    };

/** A generator turns a (non-passing) control into zero or more proposed changes. */
export type Generator = (
  ctx: AuditContext,
  control: Control,
) => Promise<Change[]>;
