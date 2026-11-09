import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "../fs-atomic.js";
import {
  assertNoSymlinkEscape,
  PathGuardError,
  resolveInsideRepo,
} from "../paths.js";
import {
  loadState,
  managedFileUnchanged,
  managedHash,
  normalizeContent,
  saveState,
} from "../state.js";
import type { Change } from "./types.js";

export type ChangeAction =
  "create" | "update" | "skip" | "unchanged" | "suggest" | "effect" | "note";

/** Suffix for a merge the factory declined to apply over a human-edited file. */
const SUGGESTED_SUFFIX = ".factory-suggested";

export interface ChangeResult {
  controlId: string;
  type: "file" | "effect" | "note";
  action: ChangeAction;
  path?: string | undefined;
  /** Current on-disk content (file changes that found an existing file). */
  before?: string | undefined;
  /** Proposed content (file changes). */
  after?: string | undefined;
  /** Set when an effect threw while applying (write mode). */
  error?: string | undefined;
  message: string;
}

export interface ApplyOptions {
  /** `dry-run` computes actions without writing; `write` applies them. */
  mode: "dry-run" | "write";
}

/**
 * Apply a plan of changes under the merge policy (ADR-0004):
 *  - a `create` file is written only when absent or factory-managed-and-unchanged
 *    (never clobbering a human's file);
 *  - a `merge` file carries its already-merged contents and is written in place —
 *    except when the target is a file the factory previously wrote that a human has
 *    since edited. Re-serializing over those edits is the "ambiguous merge" the
 *    design guards against, so the merged result is written alongside as
 *    `<path>.factory-suggested` and the human reconciles it;
 *  - a `suggest` file is always written alongside as `<path>.factory-suggested`;
 *  - effects run only in write mode; notes are reported as-is.
 *
 * In dry-run nothing is written, but each result still reports the action that would
 * be taken — against a virtual view of the files earlier changes in the same plan
 * would have written, so a run that creates a file and then merges into it previews
 * correctly. Writes update the `.factory/state.json` managed-hash registry.
 */
export async function applyChanges(
  repoPath: string,
  changes: Change[],
  options: ApplyOptions,
): Promise<ChangeResult[]> {
  const write = options.mode === "write";
  const state = await loadState(repoPath);
  state.managed ??= {};

  const results: ChangeResult[] = [];
  // Dry-run only: what earlier changes in this plan would have written.
  const virtual = new Map<string, string>();

  for (const change of changes) {
    if (change.type === "note") {
      results.push({
        controlId: change.controlId,
        type: "note",
        action: "note",
        message: change.message,
      });
      continue;
    }
    if (change.type === "effect") {
      let error: string | undefined;
      if (write) {
        try {
          await change.run();
        } catch (err) {
          // One failing setting (e.g. missing admin scope) must not abort the run.
          error = (err as Error).message;
        }
      }
      results.push({
        controlId: change.controlId,
        type: "effect",
        action: "effect",
        error,
        message: error
          ? `${change.summary} — failed: ${error}`
          : change.summary,
      });
      continue;
    }

    // Containment chokepoint: every read/write below goes through `abs`. Reject a
    // path that escapes the repo (`..`/absolute) or passes through a symlink,
    // recording a visible skip rather than aborting the whole run.
    let abs: string;
    try {
      abs = resolveInsideRepo(repoPath, change.path);
      await assertNoSymlinkEscape(repoPath, abs);
    } catch (err) {
      if (!(err instanceof PathGuardError)) throw err;
      results.push({
        controlId: change.controlId,
        type: "file",
        action: "skip",
        path: change.path,
        message: `${change.path}: refused — ${err.message}`,
      });
      continue;
    }

    if (change.op === "suggest") {
      const suggestedPath = `${change.path}${SUGGESTED_SUFFIX}`;
      if (write) {
        const suggestedAbs = resolveInsideRepo(repoPath, suggestedPath);
        await assertNoSymlinkEscape(repoPath, suggestedAbs);
        await writeFileAtomic(suggestedAbs, change.contents);
      }
      results.push({
        controlId: change.controlId,
        type: "file",
        action: "suggest",
        path: suggestedPath,
        after: change.contents,
        message: `${change.reason ?? "could not apply safely"}; wrote ${suggestedPath} to merge by hand`,
      });
      continue;
    }

    let before: string | undefined = write
      ? undefined
      : virtual.get(change.path);
    if (before === undefined) {
      try {
        before = await readFile(abs, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        before = undefined;
      }
    }
    const createdThisRun = !write && virtual.has(change.path);

    if (
      change.op === "create" &&
      before !== undefined &&
      !createdThisRun &&
      !(await managedFileUnchanged(repoPath, change.path, state))
    ) {
      results.push({
        controlId: change.controlId,
        type: "file",
        action: "skip",
        path: change.path,
        before,
        after: change.contents,
        message: `${change.path} exists and was not written by factory; skipping (edit it yourself or delete it)`,
      });
      continue;
    }

    // Merge into a file the factory previously wrote but a human has since edited:
    // don't re-serialize over their work. Write the merged result alongside as
    // `<path>.factory-suggested` and leave the human's file untouched.
    if (change.op === "merge" && before !== undefined && !createdThisRun) {
      const recorded = state.managed[change.path];
      const humanEdited =
        recorded !== undefined && managedHash(before) !== recorded;
      if (humanEdited) {
        const suggestedPath = `${change.path}${SUGGESTED_SUFFIX}`;
        if (write) {
          const suggestedAbs = resolveInsideRepo(repoPath, suggestedPath);
          await assertNoSymlinkEscape(repoPath, suggestedAbs);
          await writeFileAtomic(suggestedAbs, change.contents);
        }
        results.push({
          controlId: change.controlId,
          type: "file",
          action: "suggest",
          path: suggestedPath,
          before,
          after: change.contents,
          message: `${change.path} was edited since factory wrote it; wrote ${suggestedPath} to merge by hand`,
        });
        continue;
      }
    }

    if (
      before !== undefined &&
      normalizeContent(before) === normalizeContent(change.contents)
    ) {
      results.push({
        controlId: change.controlId,
        type: "file",
        action: "unchanged",
        path: change.path,
        before,
        after: change.contents,
        message: `${change.path} already up to date`,
      });
      // Keep the registry accurate even when the content already matches (EOL/BOM
      // differences aside).
      if (write) state.managed[change.path] = managedHash(change.contents);
      continue;
    }

    if (write) {
      await writeFileAtomic(abs, change.contents);
      state.managed[change.path] = managedHash(change.contents);
    } else {
      virtual.set(change.path, change.contents);
    }
    results.push({
      controlId: change.controlId,
      type: "file",
      action: before === undefined ? "create" : "update",
      path: change.path,
      before,
      after: change.contents,
      message: `${before === undefined ? "create" : "update"} ${change.path}`,
    });
  }

  if (write) await saveState(repoPath, state);
  return results;
}
