import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { writeFileAtomic } from "../fs-atomic.js";
import {
  loadState,
  managedFileUnchanged,
  saveState,
  sha256,
} from "../state.js";
import type { Change } from "./types.js";

export type ChangeAction =
  "create" | "update" | "skip" | "unchanged" | "effect";

export interface ChangeResult {
  controlId: string;
  type: "file" | "effect";
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
 * Apply a plan of changes under the merge policy (ADR-0004): a `create` file is
 * written only when absent or factory-managed-and-unchanged; a `merge` file is
 * written as its already-merged contents; effects run only in write mode. In
 * dry-run nothing is written, but each result still reports the action that would
 * be taken. Writes update the `.factory/state.json` managed-hash registry.
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

  for (const change of changes) {
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

    const abs = resolve(repoPath, change.path);
    let before: string | undefined;
    try {
      before = await readFile(abs, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      before = undefined;
    }

    if (
      change.op === "create" &&
      before !== undefined &&
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

    if (before === change.contents) {
      results.push({
        controlId: change.controlId,
        type: "file",
        action: "unchanged",
        path: change.path,
        before,
        after: change.contents,
        message: `${change.path} already up to date`,
      });
      // Keep the registry accurate even when the content already matches.
      if (write) state.managed[change.path] = sha256(change.contents);
      continue;
    }

    if (write) {
      await writeFileAtomic(abs, change.contents);
      state.managed[change.path] = sha256(change.contents);
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
