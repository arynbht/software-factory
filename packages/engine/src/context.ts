// The audit context: everything a detector needs to inspect one repo. Built once
// per run and passed to every detector. It exposes the local clone (fs + glob)
// and, when a token and repo slug are available, a cached GitHub client.
import { readFile as fsReadFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { glob as tinyglob } from "tinyglobby";

import { type EvidenceEntry, loadEvidence } from "./evidence.js";
import { parseRepoSlug, type RepoSlug } from "./github/slug.js";

export interface GitHubClient {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
  /** Memoise a request for the lifetime of the run so controls share responses. */
  cached<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export interface AuditContext {
  /** Absolute path to the repo being audited. */
  readonly repoPath: string;
  /** GitHub token for API-backed detectors; undefined when running offline. */
  readonly token: string | undefined;
  /** Glob (relative to the repo root) returning matching file paths, posix-style. */
  glob(pattern: string | string[]): Promise<string[]>;
  /** Read a repo-relative file as UTF-8, or null if it does not exist. */
  readFile(relPath: string): Promise<string | null>;
  /** The GitHub client, or null if there is no token or the slug is unknown. */
  github(): Promise<GitHubClient | null>;
  /** Human evidence entries from `.factory/evidence.yml` (loaded once per run). */
  evidence(): Promise<EvidenceEntry[]>;
}

export interface BuildContextOptions {
  token?: string | undefined;
  /** Override auto-detection of the repo's owner/repo (used in tests and CI). */
  github?: RepoSlug | undefined;
}

export function buildContext(
  repoPath: string,
  options: BuildContextOptions = {},
): AuditContext {
  const root = isAbsolute(repoPath)
    ? repoPath
    : resolve(process.cwd(), repoPath);

  let githubClient: Promise<GitHubClient | null> | undefined;
  let evidenceEntries: Promise<EvidenceEntry[]> | undefined;

  return {
    repoPath: root,
    token: options.token,

    async glob(pattern) {
      const patterns = Array.isArray(pattern) ? pattern : [pattern];
      return tinyglob(patterns, {
        cwd: root,
        dot: true,
        onlyFiles: true,
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

    github() {
      if (!githubClient) {
        githubClient = createGitHubClient(root, options).catch(
          (err: unknown) => {
            githubClient = undefined; // don't cache a rejection
            throw err;
          },
        );
      }
      return githubClient;
    },

    evidence() {
      if (!evidenceEntries) {
        evidenceEntries = loadEvidence(root).catch((err: unknown) => {
          evidenceEntries = undefined; // don't cache a rejection
          throw err;
        });
      }
      return evidenceEntries;
    },
  };
}

async function createGitHubClient(
  root: string,
  options: BuildContextOptions,
): Promise<GitHubClient | null> {
  if (!options.token) return null;

  const slug = options.github ?? (await resolveRepoSlug(root));
  if (!slug) return null;

  const octokit = new Octokit({ auth: options.token });
  const cache = new Map<string, Promise<unknown>>();

  return {
    octokit,
    owner: slug.owner,
    repo: slug.repo,
    cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = cache.get(key);
      if (existing) return existing as Promise<T>;
      // Evict on rejection so a transient error retries and is not amplified
      // across every control that shares the key.
      const created = fn().catch((err: unknown) => {
        cache.delete(key);
        throw err;
      });
      cache.set(key, created);
      return created;
    },
  };
}

async function resolveRepoSlug(root: string): Promise<RepoSlug | null> {
  try {
    const remotes = await simpleGit(root).getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    return parseRepoSlug(origin?.refs.fetch);
  } catch {
    return null;
  }
}
