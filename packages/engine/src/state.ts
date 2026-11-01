// `.factory/state.json`: the factory's managed state for a repo. It holds the last
// audit summary AND the hash registry of files the factory has written, so a later
// run can tell "unchanged since we wrote it" (safe to update) from "a human edited
// it" (never clobber). Audit and fix both go through here and preserve each other's
// fields.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { writeFileAtomic } from "./fs-atomic.js";

export interface FactoryState {
  version: number;
  generatedAt?: string;
  summary?: unknown;
  controls?: unknown;
  /** Repo-relative path → sha256 of the contents the factory last wrote. */
  managed?: Record<string, string>;
}

export function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

/** Load `.factory/state.json`; a missing or corrupt file yields a fresh state. */
export async function loadState(repoPath: string): Promise<FactoryState> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoPath, ".factory", "state.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FactoryState>;
    return { ...parsed, version: parsed.version ?? 1 };
  } catch {
    return { version: 1 };
  }
}

export async function saveState(
  repoPath: string,
  state: FactoryState,
): Promise<void> {
  await writeFileAtomic(
    resolve(repoPath, ".factory", "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/**
 * Whether it is safe for the factory to (over)write `relPath`: true if the file is
 * absent, or the factory wrote it and it is unchanged since. False if a human
 * created or edited it (not in the registry, or the hash differs).
 */
export async function managedFileUnchanged(
  repoPath: string,
  relPath: string,
  state: FactoryState,
): Promise<boolean> {
  const recorded = state.managed?.[relPath];
  if (!recorded) return false;
  let current: string;
  try {
    current = await readFile(resolve(repoPath, relPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
  return sha256(current) === recorded;
}
