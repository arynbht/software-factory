// The audit context: everything a detector needs to inspect one repo. Built once
// per run and passed to every detector. In M1 it exposes the local clone (fs +
// glob) and carries an optional token; the GitHub client lands in M1.4.
import { readFile as fsReadFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { glob as tinyglob } from "tinyglobby";

export interface AuditContext {
  /** Absolute path to the repo being audited. */
  readonly repoPath: string;
  /** GitHub token for API-backed detectors; undefined when running offline. */
  readonly token: string | undefined;
  /** Glob (relative to the repo root) returning matching file paths, posix-style. */
  glob(pattern: string | string[]): Promise<string[]>;
  /** Read a repo-relative file as UTF-8, or null if it does not exist. */
  readFile(relPath: string): Promise<string | null>;
}

export interface BuildContextOptions {
  token?: string | undefined;
}

export function buildContext(
  repoPath: string,
  options: BuildContextOptions = {},
): AuditContext {
  const root = isAbsolute(repoPath)
    ? repoPath
    : resolve(process.cwd(), repoPath);

  return {
    repoPath: root,
    token: options.token,

    async glob(pattern) {
      const patterns = Array.isArray(pattern) ? pattern : [pattern];
      return tinyglob(patterns, {
        cwd: root,
        dot: true,
        onlyFiles: true,
        // Never descend into dependencies or build output when auditing.
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
      });
    },

    async readFile(relPath) {
      try {
        return await fsReadFile(resolve(root, relPath), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
  };
}
