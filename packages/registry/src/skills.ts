import { access, cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTool } from "@arynbht/factory-engine";

import { ensureCached, type FetchOptions, remoteHead } from "./cache.js";
import { hashSkillDir } from "./hash.js";
import {
  AGENTS_SKILLS,
  installSkill,
  uninstallSkill,
  writeIgnores,
} from "./install.js";
import {
  loadManifests,
  lockDigest,
  readLock,
  readState,
  RegistryError,
  type SyncState,
  VENDOR_DIR,
  writeLocalManifest,
  writeLock,
  writeState,
} from "./repo.js";
import { type ScanFinding, scanSkill, type SecretScanner } from "./scan.js";
import {
  type LockEntry,
  activeAllows,
  licenseProblem,
  type Manifest,
  ManifestSchema,
  parseSource,
  SECTORS,
  SKILL_PHASES,
} from "./schema.js";

export interface RegistryOptions extends FetchOptions {
  /** Directory of bundled manifests (tests override). */
  bundledDir?: string | undefined;
  now?: Date | undefined;
  log?: ((line: string) => void) | undefined;
  /** Secret scanner (default gitleaks; tests inject one). */
  secretScanner?: SecretScanner | undefined;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function requireManifests(repoPath: string, options: RegistryOptions) {
  const { manifests, errors } = await loadManifests(
    repoPath,
    options.bundledDir,
  );
  if (errors.length > 0) {
    throw new RegistryError(
      `invalid skill manifests:\n${errors.map((e) => `  ${e.name}: ${e.message}`).join("\n")}`,
    );
  }
  return manifests;
}

/** Load a locked skill: the repo's vendored copy if present, else the cache. */
export async function loadSkill(
  repoPath: string,
  entry: LockEntry,
  options: RegistryOptions,
): Promise<{ dir: string; from: "cache" | "vendor" }> {
  const vendored = join(repoPath, VENDOR_DIR, entry.name);
  if (await exists(vendored)) {
    const hash = await hashSkillDir(vendored);
    if (hash !== entry.hash) {
      throw new RegistryError(
        `${VENDOR_DIR}/${entry.name} hashes to ${hash}, not the locked ${entry.hash}`,
      );
    }
    return { dir: vendored, from: "vendor" };
  }
  const { dir } = await ensureCached(entry, entry.hash, options);
  return { dir, from: "cache" };
}

export interface SyncResult {
  installed: string[];
  staged: string[];
  blocked: { name: string; reason: string; findings?: ScanFinding[] }[];
}

/**
 * `factory skills sync`: for every locked skill, load it (vendor or cache,
 * fetching the pinned commit if needed), verify its hash, check its manifest,
 * scan it, then install it at repo level when `scope: always` — everything else
 * stays staged in the cache for the router to load per task. Skills installed
 * by an earlier sync and no longer locked are removed.
 */
export async function syncSkills(
  repoPath: string,
  options: RegistryOptions = {},
): Promise<SyncResult> {
  const log = options.log ?? (() => undefined);
  const lock = await readLock(repoPath);
  const manifests = await requireManifests(repoPath, options);
  const result: SyncResult = { installed: [], staged: [], blocked: [] };
  const stateSkills: SyncState["skills"] = [];

  for (const entry of lock.skills) {
    const manifest = manifests.get(entry.name);
    if (!manifest) {
      result.blocked.push({
        name: entry.name,
        reason: "no manifest for this skill",
      });
      continue;
    }
    if (manifest.pin !== entry.pin || manifest.hash !== entry.hash) {
      log(
        `${entry.name}: the manifest describes ${manifest.pin.slice(0, 12)}; the lock pins ${entry.pin.slice(0, 12)} (lock wins)`,
      );
    }
    const license = licenseProblem(manifest);
    if (license) {
      result.blocked.push({ name: entry.name, reason: license });
      continue;
    }
    let loaded;
    try {
      loaded = await loadSkill(repoPath, entry, options);
    } catch (err) {
      result.blocked.push({ name: entry.name, reason: (err as Error).message });
      continue;
    }
    const findings = await scanSkill(
      loaded.dir,
      activeAllows(manifest, entry.pin),
      options.secretScanner,
    );
    if (findings.length > 0) {
      result.blocked.push({
        name: entry.name,
        reason: `scan found ${findings.length} problem(s)`,
        findings,
      });
      continue;
    }
    const install = entry.scope === "always";
    if (install) {
      await installSkill(repoPath, entry.name, loaded.dir);
      result.installed.push(entry.name);
      log(`installed ${entry.name}`);
    } else {
      result.staged.push(entry.name);
      log(`staged ${entry.name} (task scope)`);
    }
    stateSkills.push({
      name: entry.name,
      pin: entry.pin,
      hash: entry.hash,
      scope: entry.scope,
      installed: install,
      from: loaded.from,
    });
  }

  // Remove what an earlier sync installed and the lock no longer asks for.
  const previous = await readState(repoPath);
  for (const old of previous?.skills ?? []) {
    if (old.installed && !result.installed.includes(old.name)) {
      await uninstallSkill(repoPath, old.name);
      log(`removed ${old.name}`);
    }
  }

  await writeIgnores(repoPath, result.installed);
  await writeState(repoPath, {
    syncedAt: (options.now ?? new Date()).toISOString(),
    lock: await lockDigest(repoPath),
    skills: stateSkills,
    blocked: result.blocked.map(({ name, reason }) => ({ name, reason })),
  });
  return result;
}

/**
 * Is the repo's skill install current? Problems: never synced, the lock changed
 * since the last sync, a sync left skills blocked, or an installed skill no
 * longer matches its locked hash. `factory doctor` fails on any of these.
 */
export async function skillsStatus(repoPath: string): Promise<string[]> {
  const lock = await readLock(repoPath);
  if (lock.skills.length === 0) return [];
  const state = await readState(repoPath);
  if (!state)
    return ["skills have never been synced: run `factory skills sync`"];
  const problems: string[] = [];
  if (state.lock !== (await lockDigest(repoPath))) {
    problems.push(
      "the skills lock changed since the last sync: run `factory skills sync`",
    );
  }
  for (const b of state.blocked)
    problems.push(`${b.name} is blocked: ${b.reason}`);
  for (const entry of lock.skills.filter((e) => e.scope === "always")) {
    const dir = join(repoPath, AGENTS_SKILLS, entry.name);
    if (!(await exists(dir))) {
      problems.push(`${entry.name} is not installed`);
    } else if ((await hashSkillDir(dir)) !== entry.hash) {
      problems.push(
        `${AGENTS_SKILLS}/${entry.name} was modified (hash differs from the lock)`,
      );
    }
  }
  return problems;
}

/**
 * `factory skills init`: lock every skill the factory ships a manifest for (or
 * only the always-scope spine), at the manifests' pins. Entries already in the
 * lock are kept as they are — moving a pin is `update`'s job.
 */
export async function initLock(
  repoPath: string,
  options: RegistryOptions & { spineOnly?: boolean | undefined } = {},
): Promise<LockEntry[]> {
  const manifests = await requireManifests(repoPath, options);
  const lock = await readLock(repoPath);
  const have = new Set(lock.skills.map((s) => s.name));
  const added: LockEntry[] = [];
  for (const m of manifests.values()) {
    if (have.has(m.name) || (options.spineOnly && m.scope !== "always"))
      continue;
    added.push({
      name: m.name,
      source: m.source,
      pin: m.pin,
      hash: m.hash,
      scope: m.scope,
      ...(m.mirror ? { mirror: m.mirror } : {}),
    });
  }
  if (added.length > 0) {
    await writeLock(repoPath, { ...lock, skills: [...lock.skills, ...added] });
  }
  return added;
}

export interface AddOptions extends RegistryOptions {
  pin?: string | undefined;
  name?: string | undefined;
  scope?: "always" | "task" | undefined;
  sectors?: string[] | undefined;
  phases?: string[] | undefined;
  license?: string | undefined;
}

/**
 * `factory skills add owner/repo[/path]`: pin (default: the repo's HEAD), fetch,
 * hash, scan, and append to the lock. A skill the factory ships a manifest for
 * uses it; otherwise the caller supplies the fields a manifest needs (scope,
 * sectors, phases) and a repo-local manifest is written.
 */
export async function addSkill(
  repoPath: string,
  source: string,
  options: AddOptions = {},
): Promise<{ entry: LockEntry; manifestPath?: string | undefined }> {
  const manifests = await requireManifests(repoPath, options);
  const known = [...manifests.values()].find((m) => m.source === source);
  // Default name: the skill directory's name, or the repo's for a root skill.
  const { repo, path } = parseSource(source);
  const name =
    options.name ??
    known?.name ??
    (path ? path.split("/").pop() : repo.split("/")[1]);
  if (!name)
    throw new RegistryError(`can't derive a name from ${source}; pass --name`);
  // Default pin: the shipped manifest's, else the source repo's current HEAD.
  const pin = options.pin ?? known?.pin ?? (await remoteHead(source, options));

  const { dir, hash } = await ensureCached(
    { source, pin, mirror: known?.mirror },
    undefined,
    options,
  );
  const findings = await scanSkill(
    dir,
    known ? activeAllows(known, pin) : [],
    options.secretScanner,
  );
  if (findings.length > 0) {
    throw new RegistryError(
      `scan blocked ${source}:\n${findings.map((f) => `  ${f.rule} ${f.file}:${f.line} ${f.text}`).join("\n")}`,
    );
  }

  let manifestPath: string | undefined;
  let scope: "always" | "task";
  if (known && known.pin === pin && known.hash === hash) {
    scope = options.scope ?? known.scope;
  } else {
    const missing = [
      ...(options.scope ? [] : ["--scope"]),
      ...(options.sectors?.length ? [] : ["--sectors"]),
      ...(options.phases?.length ? [] : ["--phases"]),
    ];
    if (!known && missing.length > 0) {
      throw new RegistryError(
        `no manifest ships for ${source}; give ${missing.join(", ")} (sectors: ${SECTORS.join("|")}; phases: ${SKILL_PHASES.join("|")})`,
      );
    }
    const manifest: Manifest = ManifestSchema.parse({
      ...(known ?? {}),
      name,
      source,
      pin,
      hash,
      license: options.license ?? known?.license ?? "NOASSERTION",
      scope: options.scope ?? known?.scope,
      sectors: options.sectors?.length ? options.sectors : known?.sectors,
      phases: options.phases?.length ? options.phases : known?.phases,
      tokens: known?.tokens ?? (await estimateTokens(dir)),
      tested_on: (options.now ?? new Date()).toISOString().slice(0, 10),
    });
    scope = manifest.scope;
    manifestPath = await writeLocalManifest(repoPath, manifest);
  }

  const entry: LockEntry = {
    name,
    source,
    pin,
    hash,
    scope,
    ...(known?.mirror ? { mirror: known.mirror } : {}),
  };
  const lock = await readLock(repoPath);
  await writeLock(repoPath, {
    ...lock,
    skills: [...lock.skills.filter((s) => s.name !== name), entry],
  });
  return { entry, manifestPath };
}

export interface UpdatePlan {
  name: string;
  from: string;
  to: string;
  diff: string;
  findings: ScanFinding[];
  applied: boolean;
}

/**
 * `factory skills update [name]`: fetch the source repo's latest commit, show
 * the diff of the skill body against the pinned one, rescan, and move the lock
 * only when `apply` is set — a skill is a prompt, and a changed prompt is a
 * changed program, so updates are never automatic. A dirty scan never applies.
 */
export async function updateSkills(
  repoPath: string,
  name: string | undefined,
  options: RegistryOptions & { apply?: boolean | undefined } = {},
): Promise<UpdatePlan[]> {
  const lock = await readLock(repoPath);
  const manifests = await requireManifests(repoPath, options);
  const targets = lock.skills.filter((s) => !name || s.name === name);
  if (name && targets.length === 0)
    throw new RegistryError(`"${name}" is not in the lock`);

  const plans: UpdatePlan[] = [];
  const next = [...lock.skills];
  for (const entry of targets) {
    const head = await remoteHead(entry.source, options);
    if (head === entry.pin) continue;
    const old = await ensureCached(entry, entry.hash, options);
    const fresh = await ensureCached(
      { ...entry, pin: head },
      undefined,
      options,
    );
    const manifest = manifests.get(entry.name);
    const findings = await scanSkill(
      fresh.dir,
      // A new pin is a changed prompt: no earlier review applies to it.
      manifest ? activeAllows(manifest, head) : [],
      options.secretScanner,
    );
    const plan: UpdatePlan = {
      name: entry.name,
      from: entry.pin,
      to: head,
      diff: await diffDirs(old.dir, fresh.dir),
      findings,
      applied: false,
    };
    if (options.apply && findings.length === 0) {
      const i = next.findIndex((s) => s.name === entry.name);
      next[i] = { ...entry, pin: head, hash: fresh.hash };
      plan.applied = true;
    }
    plans.push(plan);
  }
  if (plans.some((p) => p.applied))
    await writeLock(repoPath, { ...lock, skills: next });
  return plans;
}

/**
 * `factory skills vendor`: opt-in offline copies of every locked skill under
 * `.factory/vendor/skills/<name>/`, verified against the lock. Sync prefers them.
 */
export async function vendorSkills(
  repoPath: string,
  options: RegistryOptions = {},
): Promise<string[]> {
  const lock = await readLock(repoPath);
  const vendored: string[] = [];
  for (const entry of lock.skills) {
    const { dir } = await ensureCached(entry, entry.hash, options);
    const target = join(repoPath, VENDOR_DIR, entry.name);
    await rm(target, { recursive: true, force: true });
    await cp(dir, target, { recursive: true });
    vendored.push(entry.name);
  }
  return vendored;
}

/** What loading the skill costs: SKILL.md, the body the agent reads, ~4 bytes a token. */
async function estimateTokens(dir: string): Promise<number> {
  const bytes = (await stat(join(dir, "SKILL.md"))).size;
  return Math.max(500, Math.round(bytes / 4 / 500) * 500);
}

/** A unified diff of two skill directories (git's no-index diff). */
async function diffDirs(a: string, b: string): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "factory-skill-diff-"));
  try {
    await cp(a, join(scratch, "old"), { recursive: true });
    await cp(b, join(scratch, "new"), { recursive: true });
    const result = await runTool(
      "git",
      ["diff", "--no-index", "--no-color", "--stat", "--patch", "old", "new"],
      scratch,
    );
    return result.stdout;
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
