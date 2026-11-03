// The audit context: everything a detector needs to inspect one repo. Built once
// per run and passed to every detector. It exposes the local clone (fs + glob)
// and, when a token and repo slug are available, a cached GitHub client.
import { readFile as fsReadFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { Profile, Waiver } from "@arynbht/factory-catalog";
import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { glob as tinyglob } from "tinyglobby";

import {
  type AiClient,
  type AiClientOptions,
  createAiClient,
  resolveAnthropicKey,
} from "./ai/client.js";
import { type EvidenceEntry, loadEvidence } from "./evidence.js";
import { parseRepoSlug, type RepoSlug } from "./github/slug.js";
import { containedReadPath } from "./paths.js";
import { loadProfile } from "./profile.js";
import { loadWaivers } from "./waivers.js";

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
  /**
   * The run's "now". Defaulted once when the context is built so the engine never
   * reads the wall clock downstream (e.g. the template generator's copyright year);
   * callers and tests inject a fixed value for deterministic output.
   */
  readonly now: Date;
  /** Glob (relative to the repo root) returning matching file paths, posix-style. */
  glob(pattern: string | string[]): Promise<string[]>;
  /** Read a repo-relative file as UTF-8, or null if it does not exist. */
  readFile(relPath: string): Promise<string | null>;
  /** The GitHub client, or null if there is no token or the slug is unknown. */
  github(): Promise<GitHubClient | null>;
  /** Human evidence entries from `.factory/evidence.yml` (loaded once per run). */
  evidence(): Promise<EvidenceEntry[]>;
  /** The resolved profile from `.factory/profile.yml`, or null if none. */
  profile(): Promise<Profile | null>;
  /** Waivers from `.factory/waivers.yml` (loaded once per run). */
  waivers(): Promise<Waiver[]>;
  /** The AI client for `claude` generators (built from the run's AI options). */
  ai(): AiClient;
  /**
   * True when AI is explicitly configured for unattended use — an injected
   * transport or an API key. The `claude` fix generator checks this so a plain
   * `factory fix`/dry-run never spawns the interactive Claude CLI; deliberate AI
   * (`factory ai`, the desktop AI screen) calls the client directly regardless.
   */
  readonly aiEnabled: boolean;
}

export interface BuildContextOptions {
  token?: string | undefined;
  /** Override auto-detection of the repo's owner/repo (used in tests and CI). */
  github?: RepoSlug | undefined;
  /** The run's "now" (defaults to the current time); inject for determinism. */
  now?: Date | undefined;
  /** Options for the AI client (key, model, or an injected transport for tests). */
  ai?: AiClientOptions | undefined;
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
  let profileData: Promise<Profile | null> | undefined;
  let waiverData: Promise<Waiver[]> | undefined;
  let aiClient: AiClient | undefined;

  // AI is "enabled for unattended use" when a transport is injected (tests) or an
  // API key is resolvable now. The interactive CLI deliberately does NOT count,
  // so `fix` won't spawn it; `factory ai` uses the client directly either way.
  const aiEnabled =
    Boolean(options.ai?.transport) ||
    resolveAnthropicKey(options.ai?.apiKey) !== undefined;

  return {
    repoPath: root,
    token: options.token,
    now: options.now ?? new Date(),
    aiEnabled,

    async glob(pattern) {
      const patterns = Array.isArray(pattern) ? pattern : [pattern];
      return tinyglob(patterns, {
        cwd: root,
        dot: true,
        onlyFiles: true,
        // Don't traverse into symlinked directories: a repo can't point the
        // glob at files outside itself (secret-leak / escape guard, #95).
        followSymbolicLinks: false,
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
      });
    },

    async readFile(relPath) {
      // Follow symlinks only while they stay inside the repo; a file symlinked to
      // e.g. `~/.aws/credentials` reads as absent rather than disclosing it.
      const real = await containedReadPath(root, relPath);
      if (real === null) return null;
      try {
        return await fsReadFile(real, "utf8");
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

    profile() {
      if (!profileData) {
        profileData = loadProfile(root).catch((err: unknown) => {
          profileData = undefined; // don't cache a rejection
          throw err;
        });
      }
      return profileData;
    },

    waivers() {
      if (!waiverData) {
        waiverData = loadWaivers(root).catch((err: unknown) => {
          waiverData = undefined; // don't cache a rejection
          throw err;
        });
      }
      return waiverData;
    },

    ai() {
      aiClient ??= createAiClient(options.ai ?? {});
      return aiClient;
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
