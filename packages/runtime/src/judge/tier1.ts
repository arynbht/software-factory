import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Control, loadBundledCatalog } from "@arynbht/factory-catalog";
import {
  allowlistedEnv,
  buildContext,
  type ControlResult,
  deepEqual,
  detectStacks,
  evaluateControls,
  runTool,
  templateStacks,
  ToolNotFoundError,
} from "@arynbht/factory-engine";
import { type SimpleGit, simpleGit } from "simple-git";

import {
  type DiffEntry,
  findProtected,
  isProtectedConfig,
  isTestFile,
  type ProtectedFinding,
} from "./protected.js";

/** A check's state on one side: green, red (fail, or could not run), or n/a. */
export type Side = "green" | "red" | "n/a";

export interface CheckOutcome {
  id: string;
  title: string;
  base: Side;
  head: Side;
  /**
   * `pass` green on the change; `fixed` red at base, green now; `fail` red now
   * but not at base (this change broke it, or it can't be checked now);
   * `pre-existing` red on both — reported, not blamed on this change.
   */
  outcome: "pass" | "fixed" | "fail" | "pre-existing" | "n/a";
  message: string;
}

export interface Tier1Result {
  verdict: "pass" | "fail" | "needs-human";
  base: string;
  head: string;
  mergeBase: string;
  changedFiles: number;
  protected: ProtectedFinding[];
  checks: CheckOutcome[];
  /** Why the verdict is `fail` when no individual check explains it. */
  notes: string[];
  workDir: string;
}

export interface Tier1Options {
  /** The repo holding both commits (the primary checkout). */
  repoPath: string;
  /** The base ref the change targets, e.g. `origin/main`. */
  base: string;
  /** The change under review (default `HEAD`). */
  head?: string | undefined;
  /** Control ids to run (default: every `quality` control that applies). */
  checks?: readonly string[] | undefined;
  /** Where to clone (default: a fresh temp dir, removed unless `keep`). */
  workDir?: string | undefined;
  keep?: boolean | undefined;
  /**
   * Variables passed to installs and checks on top of the allowlist (system
   * paths, home/temp dirs, toolchain homes). Nothing else from the caller's
   * shell reaches the repo's scripts: no tokens, no API keys.
   */
  env?: readonly string[] | undefined;
  /**
   * Protected changes a person already allowed (at build). They're still put
   * back to base for the checks, but they don't make the verdict `needs-human`.
   */
  allowed?: ((finding: ProtectedFinding) => boolean) | undefined;
  /** Install dependencies in the clone before checking (default true). */
  install?: boolean | undefined;
  now?: Date | undefined;
  /** Progress lines, e.g. to stderr. */
  log?: ((line: string) => void) | undefined;
}

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
];
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const CLONE_PREFIX = "factory-judge-";
const STALE_MS = 24 * 60 * 60_000;

/** Remove judge clones a crashed run left behind (older than 24 hours). */
export async function sweepStaleClones(
  root: string = tmpdir(),
  now: number = Date.now(),
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(CLONE_PREFIX)) continue;
    const path = join(root, name);
    try {
      if (now - (await stat(path)).mtimeMs > STALE_MS) {
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      // Another run may be removing it; not our problem.
    }
  }
}

/**
 * Judge tier 1: deterministic checks on a clean clone, never the agent's
 * worktree.
 *
 *  1. Diff `merge-base(base, head)..head` and look for protected changes
 *     (`.factory/**`, lint/CI config, package.json scripts, existing tests,
 *     added suppressions). Any → `needs-human`.
 *  2. Clone the repo, check out the merge-base, install, run the checks: the
 *     baseline.
 *  3. Check out `head`, put every protected path back as it was at base (so the
 *     change is judged by the rules it was written against, not rules it
 *     edited), install if dependencies changed, and run the checks again.
 *  4. Fail closed: a check that can't run (missing script, missing tool,
 *     timeout) is red. Red on both sides is pre-existing; red only on the
 *     change is a failure.
 */
export async function runTier1(options: Tier1Options): Promise<Tier1Result> {
  const log = options.log ?? (() => undefined);
  const repo = simpleGit(options.repoPath);
  const base = (await repo.revparse([options.base])).trim();
  const head = (await repo.revparse([options.head ?? "HEAD"])).trim();
  const mergeBase = (await repo.raw(["merge-base", base, head])).trim();

  const diff = parseNameStatus(
    await repo.raw(["diff", "--name-status", "-M", mergeBase, head]),
  );
  const added = parseAddedLines(
    await repo.raw(["diff", "-U0", "--no-color", mergeBase, head]),
  );
  const baseScripts = await scriptsAt(repo, mergeBase);
  const headScripts = await scriptsAt(repo, head);
  const scriptsChanged = !deepEqual(baseScripts, headScripts);
  const protectedFindings = findProtected(diff, added, scriptsChanged);

  // A unique directory per run (two judges on one task never collide), outside
  // the repo so it never shows up in `git status` or the repo's own audits.
  await sweepStaleClones();
  const workDir =
    options.workDir ?? (await mkdtemp(join(tmpdir(), CLONE_PREFIX)));
  const notes: string[] = [];
  try {
    log(`cloning into ${workDir}`);
    await simpleGit().clone(options.repoPath, workDir, [
      "--quiet",
      "--shared",
      "--no-checkout",
    ]);
    // simple-git guards core.hooksPath against hook injection; here it points
    // at an empty directory we just made, which is the opposite of injection.
    const clone = simpleGit(workDir, {
      unsafe: { allowUnsafeHooksPath: true },
    });
    // The target repo's hooks never run inside the judge.
    const noHooks = join(workDir, ".git", "factory-no-hooks");
    await mkdir(noHooks, { recursive: true });
    await clone.addConfig("core.hooksPath", noHooks);

    // Baseline.
    await clone.raw(["checkout", "--quiet", "--detach", mergeBase]);
    const install = options.install ?? true;
    const baseInstall = install
      ? await installDeps(workDir, log, options.env)
      : null;
    log("running checks at base");
    const baseResults = await runChecks(workDir, options);

    // The change, judged by the base's rules.
    await clone.raw(["checkout", "--quiet", "--detach", head]);
    await restoreProtected(clone, workDir, diff, mergeBase);
    if (scriptsChanged) await restoreScripts(workDir, baseScripts);
    const depsChanged = diff.some(
      (e) => e.path === "package.json" || LOCKFILES.includes(e.path),
    );
    const headInstall =
      install && depsChanged
        ? await installDeps(workDir, log, options.env)
        : baseInstall;
    log("running checks on the change");
    const headResults = await runChecks(workDir, options);

    if (headInstall && !headInstall.ok) {
      notes.push(`dependency install failed: ${headInstall.message}`);
    }

    const checks = compare(baseResults, headResults);
    const ran = checks.filter((c) => c.outcome !== "n/a");
    if (ran.length === 0) {
      notes.push(
        "no check applies to this repo (unknown stack?); nothing was verified",
      );
    }

    // The judge installs only Node dependencies so far. For other stacks, a
    // check that's red on both sides may just be a dependency the clone lacks,
    // so "pre-existing" can't be trusted there: fail and say why, never pass.
    const unverifiable = templateStacks(
      await detectStacks(buildContext(workDir)),
    ).filter((s) => s !== "node");
    const preExisting = checks.some((c) => c.outcome === "pre-existing");
    if (unverifiable.length > 0 && preExisting) {
      notes.push(
        `${unverifiable.join("/")} dependencies aren't installed by the judge yet; a check that's red at base may be a missing dependency, so the judge can't verify this change`,
      );
    }

    const failed =
      ran.length === 0 ||
      (unverifiable.length > 0 && preExisting) ||
      checks.some((c) => c.outcome === "fail") ||
      (headInstall !== null && !headInstall.ok && !(baseInstall?.ok === false));

    const unanswered = protectedFindings.filter(
      (f) => !(options.allowed?.(f) ?? false),
    );
    return {
      verdict: unanswered.length > 0 ? "needs-human" : failed ? "fail" : "pass",
      base,
      head,
      mergeBase,
      changedFiles: diff.length,
      protected: protectedFindings,
      checks,
      notes,
      workDir,
    };
  } finally {
    if (!options.keep && !options.workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

/**
 * The checks a change is judged on by default: the quality lane's code checks.
 * Repository settings (github-api) are posture, judged by `factory audit`, not
 * by a change.
 */
export async function changeChecks(): Promise<Control[]> {
  const { controls } = await loadBundledCatalog();
  return controls.filter(
    (c) =>
      c.lane === "quality" && !c.detect.some((d) => d.type === "github-api"),
  );
}

async function runChecks(
  dir: string,
  options: Tier1Options,
): Promise<ControlResult[]> {
  const selected: Control[] = options.checks
    ? (await loadBundledCatalog()).controls.filter((c) =>
        options.checks?.includes(c.id),
      )
    : await changeChecks();
  // One at a time, test runs first: coverage is read from what *this* side's
  // test run wrote, so the previous side's report is removed before it starts.
  const ordered = [...selected].sort(
    (a, b) => Number(!runsTests(a)) - Number(!runsTests(b)),
  );
  await rm(join(dir, "coverage"), { recursive: true, force: true });
  const ctx = buildContext(dir, {
    runCommands: true,
    commandEnv: allowlistedEnv(options.env),
    now: options.now,
  });
  const profile = await ctx.profile().catch(() => null);
  // Waivers are posture decisions; the judge holds every check to its result.
  return evaluateControls(ordered, ctx, {
    profile,
    waivers: [],
    now: options.now,
    concurrency: 1,
  });
}

function runsTests(control: Control): boolean {
  return control.id === "quality.tests.pass";
}

function side(result: ControlResult | undefined): Side {
  if (!result || result.status === "n/a") return "n/a";
  return result.status === "pass" ? "green" : "red";
}

function compare(
  baseResults: ControlResult[],
  headResults: ControlResult[],
): CheckOutcome[] {
  const baseById = new Map(baseResults.map((r) => [r.controlId, r]));
  return headResults.map((h) => {
    const b = baseById.get(h.controlId);
    const before = side(b);
    const after = side(h);
    const message =
      h.detectors.find((d) => d.status !== "pass")?.message ??
      h.detectors[0]?.message ??
      "";
    let outcome: CheckOutcome["outcome"];
    if (after === "n/a") outcome = "n/a";
    else if (after === "green") outcome = before === "red" ? "fixed" : "pass";
    else outcome = before === "red" ? "pre-existing" : "fail";
    return {
      id: h.controlId,
      title: h.title,
      base: before,
      head: after,
      outcome,
      message,
    };
  });
}

/** Put protected paths back to their base state in the clone. */
async function restoreProtected(
  clone: SimpleGit,
  dir: string,
  diff: readonly DiffEntry[],
  mergeBase: string,
): Promise<void> {
  for (const entry of diff) {
    const config =
      isProtectedConfig(entry.path) ||
      (entry.oldPath !== undefined && isProtectedConfig(entry.oldPath));
    const existingTest =
      entry.status !== "A" &&
      (isTestFile(entry.path) ||
        (entry.oldPath !== undefined && isTestFile(entry.oldPath)));
    if (!config && !existingTest) continue;

    // Whatever the change put at the new path goes...
    if (entry.status !== "D") {
      await rm(join(dir, entry.path), { force: true });
    }
    // ...and whatever base had comes back.
    const basePath =
      entry.status === "R"
        ? entry.oldPath
        : entry.status === "A"
          ? undefined
          : entry.path;
    if (basePath) {
      await clone.raw(["checkout", "--quiet", mergeBase, "--", basePath]);
    }
  }
}

async function restoreScripts(
  dir: string,
  baseScripts: Record<string, unknown>,
): Promise<void> {
  const path = join(dir, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  pkg["scripts"] = baseScripts;
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

async function scriptsAt(
  repo: SimpleGit,
  rev: string,
): Promise<Record<string, unknown>> {
  try {
    const text = await repo.show([`${rev}:package.json`]);
    const pkg = JSON.parse(text) as { scripts?: Record<string, unknown> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

/** Install Node dependencies with the repo's package manager, from its lockfile. */
async function installDeps(
  dir: string,
  log: (line: string) => void,
  env: readonly string[] | undefined,
): Promise<{ ok: boolean; message: string } | null> {
  const pkgPath = join(dir, "package.json");
  if (!(await exists(pkgPath))) return null;
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    dependencies?: object;
    devDependencies?: object;
  };
  const deps =
    Object.keys(pkg.dependencies ?? {}).length +
    Object.keys(pkg.devDependencies ?? {}).length;
  if (deps === 0) return null;

  let cmd: [string, string[]];
  if (await exists(join(dir, "pnpm-lock.yaml"))) {
    cmd = ["pnpm", ["install", "--frozen-lockfile"]];
  } else if (await exists(join(dir, "yarn.lock"))) {
    cmd = ["yarn", ["install", "--frozen-lockfile"]];
  } else if (await exists(join(dir, "package-lock.json"))) {
    cmd = ["npm", ["ci", "--no-audit", "--no-fund"]];
  } else {
    cmd = ["npm", ["install", "--no-audit", "--no-fund"]];
  }
  log(`installing dependencies: ${cmd[0]} ${cmd[1].join(" ")}`);
  try {
    const result = await runTool(cmd[0], cmd[1], dir, {
      timeoutMs: INSTALL_TIMEOUT_MS,
      env: allowlistedEnv(env),
    });
    return result.exitCode === 0
      ? { ok: true, message: "installed" }
      : {
          ok: false,
          message: `${cmd[0]} exited ${result.exitCode}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`,
        };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof ToolNotFoundError
          ? `${cmd[0]} is not installed`
          : (err as Error).message,
    };
  }
}

export function parseNameStatus(output: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [code = "", a = "", b] = line.split("\t");
    const kind = code[0];
    if (kind === "R" || kind === "C") {
      entries.push(
        kind === "R"
          ? { status: "R", path: b ?? a, oldPath: a }
          : { status: "A", path: b ?? a },
      );
    } else if (kind === "A" || kind === "M" || kind === "D") {
      entries.push({ status: kind, path: a });
    } else if (kind === "T") {
      entries.push({ status: "M", path: a });
    }
  }
  return entries;
}

export function parseAddedLines(output: string): Map<string, string[]> {
  const added = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      current = target === "/dev/null" ? null : target.replace(/^b\//, "");
      continue;
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      const lines = added.get(current) ?? [];
      lines.push(line.slice(1));
      added.set(current, lines);
    }
  }
  return added;
}
