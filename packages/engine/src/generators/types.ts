import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";

/**
 * A proposed change produced by a generator.
 * - `file` with op `create`: a whole file the factory owns — written only if it is
 *   absent or factory-managed-and-unchanged (never clobbers a human's file).
 * - `file` with op `merge`: contents are the already-merged result of a structural
 *   edit, so writing them is a minimal change that preserves the human's content.
 * - `file` with op `suggest`: the factory could not apply the change safely (the
 *   target is ambiguous, or would overwrite a human's value); `contents` are
 *   written beside the target as `<path>.factory-suggested` for a human to merge.
 * - `effect`: a non-file action (a GitHub setting, an installer) with a summary and
 *   a thunk run only in write mode.
 * - `note`: nothing to change, but the user should know why (e.g. a template that
 *   needs a profile value that isn't set, or a stack the factory doesn't know).
 */
export type Change =
  | {
      type: "file";
      controlId: string;
      path: string;
      contents: string;
      op: "create" | "merge" | "suggest";
      /** Why a `suggest` was written instead of the change itself. */
      reason?: string | undefined;
      /** The control marks this file factory-owned (`managed: true`): rewrite it even after edits. */
      managed?: boolean | undefined;
    }
  | {
      type: "effect";
      controlId: string;
      summary: string;
      run: () => Promise<void>;
    }
  | {
      type: "note";
      controlId: string;
      message: string;
    };

/** A generator turns a (non-passing) control into zero or more proposed changes. */
export type Generator = (
  ctx: AuditContext,
  control: Control,
) => Promise<Change[]>;
