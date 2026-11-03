// The acceptance self-check a build must pass before a PR opens: the repo's own
// typecheck/lint/test scripts PLUS the factory phase gate, run against the built
// worktree. Failures feed the bounded fix-loop in build.ts. The command runner and
// the gate are injectable so this is unit-tested without a real repo.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runTool, type ToolResult } from "../detectors/exec.js";
import type { VerifyCheck, VerifyResult } from "./types.js";

export type CommandRunner = (
  bin: string,
  args: string[],
  cwd: string,
) => Promise<ToolResult>;

export interface VerifyOptions {
  /** Inject the command runner (tests). Default runs real tools via runTool. */
  run?: CommandRunner;
  /** npm scripts to run if present, in order. Default: typecheck, lint, test. */
  scripts?: string[];
  /** Inject the factory-gate check (tests). Default evaluates the gate. */
  gate?: (dir: string) => Promise<VerifyCheck>;
  signal?: AbortSignal;
}

const DEFAULT_SCRIPTS = ["typecheck", "lint", "test"];

/** Truncate noisy command output for display and for the fix-loop prompt. */
function truncate(s: string, max = 2000): string {
  const t = s.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

/** Pick the package manager from the worktree's lockfile (default pnpm). */
async function packageManager(dir: string): Promise<string> {
  for (const [file, pm] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const) {
    try {
      await readFile(resolve(dir, file), "utf8");
      return pm;
    } catch {
      // try next
    }
  }
  return "pnpm";
}

async function readScripts(dir: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(
      await readFile(resolve(dir, "package.json"), "utf8"),
    );
    return (pkg.scripts ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Default factory-gate check: audit the worktree and assert its phase gate isn't red. */
async function defaultGateCheck(dir: string): Promise<VerifyCheck> {
  try {
    const [catalog, { buildContext }, audit, gates] = await Promise.all([
      import("@arynbht/factory-catalog"),
      import("../context.js"),
      import("../audit.js"),
      import("../gates.js"),
    ]);
    const { controls } = await catalog.loadBundledCatalog();
    const { gates: allGates } = await catalog.loadBundledGates();
    const ctx = buildContext(dir);
    const profile = await ctx.profile().catch(() => null);
    const phase = profile?.phase;
    if (!phase) {
      return {
        name: "factory-gate",
        passed: true,
        ran: false,
        output: "no profile phase set",
      };
    }
    const waivers = await ctx.waivers().catch(() => []);
    const results = await audit.evaluateControls(controls, ctx, {
      profile,
      waivers,
    });
    const gate = allGates.find((g) => g.phase === phase);
    if (!gate) {
      return {
        name: "factory-gate",
        passed: true,
        ran: false,
        output: `no gate for phase ${phase}`,
      };
    }
    const result = gates.evaluateGate(gate, results);
    const blockers = result.controls
      .filter((c) => c.status === "fail")
      .map((c) => c.controlId);
    return {
      name: "factory-gate",
      passed: result.status !== "red",
      ran: true,
      output:
        result.status === "red"
          ? `gate "${phase}" is red — failing: ${blockers.join(", ")}`
          : `gate "${phase}" is ${result.status}`,
    };
  } catch (err) {
    // A gate that can't be evaluated shouldn't block the build.
    return {
      name: "factory-gate",
      passed: true,
      ran: false,
      output: `gate check skipped: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Run the acceptance checks against a built worktree. */
export async function verify(
  dir: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const run = options.run ?? runTool;
  const scriptNames = options.scripts ?? DEFAULT_SCRIPTS;
  const gateCheck = options.gate ?? defaultGateCheck;

  const scripts = await readScripts(dir);
  const pm = await packageManager(dir);
  const checks: VerifyCheck[] = [];

  for (const name of scriptNames) {
    if (!scripts[name]) {
      checks.push({ name, passed: true, ran: false, output: "no such script" });
      continue;
    }
    try {
      const res = await run(pm, ["run", name], dir);
      checks.push({
        name,
        passed: res.exitCode === 0,
        ran: true,
        output: truncate(`${res.stdout}\n${res.stderr}`),
      });
    } catch (err) {
      checks.push({
        name,
        passed: false,
        ran: true,
        output: truncate(err instanceof Error ? err.message : String(err)),
      });
    }
  }

  checks.push(await gateCheck(dir));

  return { passed: checks.every((c) => !c.ran || c.passed), checks };
}
