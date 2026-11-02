// Path containment guards for the generator write path and the AI read path
// (ADR-0004: generators write only under the target repo; secrets never leave
// it). Two escape vectors are covered: a lexical escape (`..` or an absolute
// path) and a symlink escape (a symlinked target or intermediate directory that
// redirects a read/write outside the repo even when the lexical path is clean).

import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** A path that escapes the target repo or passes through a symlink. */
export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathGuardError";
  }
}

/** True when `abs` is `root` itself or lexically nested under it. */
export function isInsideRepo(root: string, abs: string): boolean {
  const rel = relative(resolve(root), resolve(abs));
  if (rel === "") return true;
  // relative() yields `..` or `..<sep>…` for an escape; a contained sibling
  // like `..foo` is kept (it does not start with the `..` path segment).
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve a repo-relative path and assert it stays inside the repo. Throws
 * {@link PathGuardError} on an absolute path or one that escapes via `..`. This
 * is a lexical check only — pair it with {@link assertNoSymlinkEscape} before a
 * write that could pass through a symlink.
 */
export function resolveInsideRepo(root: string, relPath: string): string {
  const abs = resolve(root, relPath);
  if (isAbsolute(relPath) || !isInsideRepo(root, abs)) {
    throw new PathGuardError(`path escapes the repository: ${relPath}`);
  }
  return abs;
}

/** The deepest existing ancestor of `abs` (abs itself if it already exists). */
async function deepestExisting(abs: string): Promise<string> {
  let p = abs;
  for (;;) {
    try {
      await lstat(p);
      return p;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = dirname(p);
      if (parent === p) return p; // reached the filesystem root
      p = parent;
    }
  }
}

/**
 * Assert that a write to `abs` neither targets a symlink nor resolves — through
 * a symlinked ancestor directory — outside the repo. `writeFileAtomic` renames
 * over the final name (which would replace a target symlink), but a symlinked
 * intermediate directory, e.g. `config -> /etc`, still escapes; realpath the
 * nearest existing ancestor to catch it. Throws {@link PathGuardError}.
 */
export async function assertNoSymlinkEscape(
  root: string,
  abs: string,
): Promise<void> {
  // Refuse a symlink at the exact target (a read of it would disclose the
  // linked file; a naive write would follow it).
  try {
    if ((await lstat(abs)).isSymbolicLink()) {
      throw new PathGuardError(`refusing to use a symlinked path: ${abs}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // target absent — fine, fall through to the ancestor check
  }

  const realRoot = await realpath(resolve(root));
  const realAncestor = await realpath(await deepestExisting(abs));
  if (!isInsideRepo(realRoot, realAncestor)) {
    throw new PathGuardError(`path resolves outside the repository: ${abs}`);
  }
}

/**
 * Resolve a repo-relative path for **reading**, following symlinks, and return
 * its real location only if it stays inside the repo. Returns null when the path
 * is absolute, escapes lexically, resolves (via a symlink) outside the repo, or
 * does not exist. Callers treat null as "absent", the safe default for a secret
 * guard: a file symlinked to `~/.aws/credentials` reads as missing, not leaked.
 */
export async function containedReadPath(
  root: string,
  relPath: string,
): Promise<string | null> {
  if (isAbsolute(relPath)) return null;
  const abs = resolve(root, relPath);
  if (!isInsideRepo(root, abs)) return null;
  try {
    const realRoot = await realpath(resolve(root));
    const real = await realpath(abs); // follows symlinks; ENOENT if absent
    return isInsideRepo(realRoot, real) ? real : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
