// A user-level, content-addressed skill cache shared by every repo:
//   <root>/<sha256 hex>/skill/              the skill directory, byte-exact
//   <root>/<sha256 hex>/factory.skill.yml   its manifest, for offline routing
// Entries are verified against their hash on every load.
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";

import { hashSkillDir } from "./hash.js";
import { parseSource } from "./schema.js";

export function cacheRoot(): string {
  if (process.env.FACTORY_SKILLS_CACHE) return process.env.FACTORY_SKILLS_CACHE;
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "factory", "skills");
}

export function cacheEntry(hash: string, root = cacheRoot()): string {
  return join(root, hash.replace(/^sha256:/, ""));
}

export class SkillHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillHashError";
  }
}

export class SkillFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillFetchError";
  }
}

export interface FetchOptions {
  /** Map `owner/repo` to a clone URL (tests point this at local repos). */
  gitUrl?: ((repo: string) => string) | undefined;
  /** Cache root (default `cacheRoot()`). */
  root?: string | undefined;
  /** Drop a cached entry that fails its hash and fetch again. */
  refetch?: boolean | undefined;
}

export const githubUrl = (repo: string): string =>
  `https://github.com/${repo}.git`;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * The verified cache directory for a pinned skill, fetching it if needed.
 *
 * With `expectedHash`, a cached entry must still match it (a tampered cache
 * fails rather than loads), and freshly fetched content must match it too. With
 * no expected hash (adding a new skill) the content is hashed and cached under
 * whatever it hashes to. Tries `source`, then `mirror`.
 */
export async function ensureCached(
  skill: { source: string; pin: string; mirror?: string | undefined },
  expectedHash: string | undefined,
  options: FetchOptions = {},
): Promise<{ dir: string; hash: string }> {
  const root = options.root ?? cacheRoot();
  if (expectedHash) {
    const entry = cacheEntry(expectedHash, root);
    const skillDir = join(entry, "skill");
    if (await exists(skillDir)) {
      const actual = await hashSkillDir(skillDir);
      if (actual === expectedHash) return { dir: skillDir, hash: actual };
      if (!options.refetch) {
        throw new SkillHashError(
          `cached skill at ${skillDir} hashes to ${actual}, not ${expectedHash}: the cache was modified. Re-run with --refetch to replace it.`,
        );
      }
      await rm(entry, { recursive: true, force: true });
    }
  }

  const fetched = await fetchPinned(skill, options);
  try {
    const hash = await hashSkillDir(fetched.skillDir);
    if (expectedHash && hash !== expectedHash) {
      throw new SkillHashError(
        `${skill.source}@${skill.pin.slice(0, 12)} hashes to ${hash}, but the lock expects ${expectedHash}`,
      );
    }
    const entry = cacheEntry(hash, root);
    const target = join(entry, "skill");
    if (!(await exists(target))) {
      await cp(fetched.skillDir, target, {
        recursive: true,
        filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src),
      });
    }
    return { dir: target, hash };
  } finally {
    await rm(fetched.tmp, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function fetchPinned(
  skill: { source: string; pin: string; mirror?: string | undefined },
  options: FetchOptions,
): Promise<{ tmp: string; skillDir: string }> {
  const toUrl = options.gitUrl ?? githubUrl;
  const errors: string[] = [];
  for (const source of [skill.source, skill.mirror].filter((s): s is string =>
    Boolean(s),
  )) {
    const { repo, path } = parseSource(source);
    const tmp = await mkdtemp(join(tmpdir(), "factory-skill-"));
    try {
      const git = simpleGit(tmp);
      await git.init();
      // Byte-exact checkout on every OS: no CRLF conversion, so a pin hashes
      // the same on Windows as on Linux.
      await git.addConfig("core.autocrlf", "false");
      await git.addConfig("core.eol", "lf");
      await git.raw([
        "fetch",
        "--quiet",
        "--depth",
        "1",
        toUrl(repo),
        skill.pin,
      ]);
      await git.raw(["checkout", "--quiet", "FETCH_HEAD"]);
      const skillDir = path ? join(tmp, ...path.split("/")) : tmp;
      if (!(await exists(join(skillDir, "SKILL.md")))) {
        throw new Error(`no SKILL.md at ${path || "the repo root"}`);
      }
      return { tmp, skillDir };
    } catch (err) {
      errors.push(`${source}: ${(err as Error).message.trim().split("\n")[0]}`);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  throw new SkillFetchError(
    `could not fetch ${skill.source}@${skill.pin.slice(0, 12)} (${errors.join("; ")})`,
  );
}

/** The current HEAD commit of a skill's source repo (for `add` and `update`). */
export async function remoteHead(
  source: string,
  options: FetchOptions = {},
): Promise<string> {
  const { repo } = parseSource(source);
  const out = await simpleGit().listRemote([
    (options.gitUrl ?? githubUrl)(repo),
    "HEAD",
  ]);
  const sha = out.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new SkillFetchError(`could not resolve HEAD of ${repo}`);
  }
  return sha;
}
