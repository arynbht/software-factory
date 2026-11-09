// Per-repo registry files: the lock (committed), repo-local manifests
// (committed), and the sync state (per machine, git-ignored).
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";

import {
  type Lock,
  LockSchema,
  type Manifest,
  type ManifestIssue,
  ManifestSchema,
  validateManifestSet,
} from "./schema.js";

export const LOCK_FILE = ".factory/skills.lock";
export const STATE_FILE = ".factory/skills.state.json";
export const LOCAL_MANIFESTS = ".factory/skills/manifests";
export const VENDOR_DIR = ".factory/vendor/skills";

/** The manifests that ship with the factory. */
export function bundledManifestsDir(): string {
  return fileURLToPath(new URL("../manifests", import.meta.url));
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export async function readLock(repoPath: string): Promise<Lock> {
  let text: string;
  try {
    text = await readFile(join(repoPath, LOCK_FILE), "utf8");
  } catch {
    return { version: 1, skills: [] };
  }
  const parsed = LockSchema.safeParse(parse(text) ?? { version: 1 });
  if (!parsed.success) {
    throw new RegistryError(
      `${LOCK_FILE} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export async function writeLock(repoPath: string, lock: Lock): Promise<void> {
  const path = join(repoPath, LOCK_FILE);
  await mkdir(dirname(path), { recursive: true });
  const sorted = {
    ...lock,
    skills: [...lock.skills].sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeFile(
    path,
    `# Pinned skills for this repo. Edit with \`factory skills add|update\`.\n${stringify(sorted)}`,
    "utf8",
  );
}

/** sha256 of the lock file's bytes, so state can tell when the lock moved. */
export async function lockDigest(repoPath: string): Promise<string> {
  try {
    const bytes = await readFile(join(repoPath, LOCK_FILE));
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return "none";
  }
}

async function readManifestDir(dir: string): Promise<{
  manifests: Manifest[];
  errors: ManifestIssue[];
}> {
  const manifests: Manifest[] = [];
  const errors: ManifestIssue[] = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /\.ya?ml$/.test(n));
  } catch {
    return { manifests, errors };
  }
  for (const file of names.sort()) {
    const parsed = ManifestSchema.safeParse(
      parse(await readFile(join(dir, file), "utf8")),
    );
    if (parsed.success) manifests.push(parsed.data);
    else {
      errors.push({
        name: file,
        message: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      });
    }
  }
  return { manifests, errors };
}

/**
 * Every manifest the repo can use: the factory's bundled ones, overridden by
 * name by the repo's own (`.factory/skills/manifests/`). Schema errors and
 * cross-manifest problems (unknown or one-sided conflicts) are returned, not
 * thrown, so callers can report them all.
 */
export async function loadManifests(
  repoPath: string,
  bundledDir: string = bundledManifestsDir(),
): Promise<{ manifests: Map<string, Manifest>; errors: ManifestIssue[] }> {
  const bundled = await readManifestDir(bundledDir);
  const local = await readManifestDir(join(repoPath, LOCAL_MANIFESTS));
  const manifests = new Map<string, Manifest>();
  for (const m of [...bundled.manifests, ...local.manifests]) {
    manifests.set(m.name, m);
  }
  return {
    manifests,
    errors: [
      ...bundled.errors,
      ...local.errors,
      ...validateManifestSet([...manifests.values()]),
    ],
  };
}

export async function writeLocalManifest(
  repoPath: string,
  manifest: Manifest,
): Promise<string> {
  const rel = `${LOCAL_MANIFESTS}/${manifest.name}.yml`;
  await mkdir(join(repoPath, LOCAL_MANIFESTS), { recursive: true });
  await writeFile(join(repoPath, rel), stringify(manifest), "utf8");
  return rel;
}

export interface SyncState {
  syncedAt: string;
  lock: string;
  skills: {
    name: string;
    pin: string;
    hash: string;
    scope: "always" | "task";
    installed: boolean;
    from: "cache" | "vendor";
  }[];
  blocked: { name: string; reason: string }[];
}

export async function readState(repoPath: string): Promise<SyncState | null> {
  try {
    return JSON.parse(
      await readFile(join(repoPath, STATE_FILE), "utf8"),
    ) as SyncState;
  } catch {
    return null;
  }
}

export async function writeState(
  repoPath: string,
  state: SyncState,
): Promise<void> {
  const path = join(repoPath, STATE_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
