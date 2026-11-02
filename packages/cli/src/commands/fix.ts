import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type Control,
  loadBundledCatalog,
  loadBundledGates,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  applyChanges,
  buildContext,
  evaluateControls,
  EvidenceError,
  FixPrError,
  openFixPr,
  planControls,
  ProfileError,
  resolveToken,
  selectForGate,
  WaiverError,
} from "@arynbht/factory-engine";

import { renderFixPlan } from "../report.js";

export interface FixFlags {
  control?: string;
  gate?: string;
  lane?: string;
  write?: boolean;
  pr?: boolean;
  token?: string;
  color?: boolean;
}

export interface RunFixOptions {
  now?: Date | undefined;
  token?: string | null | undefined;
  /** Today's date as YYYY-MM-DD, for the --pr branch name (CLI passes it in). */
  today?: string | undefined;
}

/** Non-passing statuses that a fix should try to remediate. */
const FIXABLE = new Set(["fail", "needs-evidence", "skip"]);

/** `factory fix` — turn non-passing controls into file/setting changes. */
export async function runFix(
  path: string,
  flags: FixFlags,
  options: RunFixOptions = {},
): Promise<number> {
  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) {
      console.error(`factory fix: not a directory: ${path}`);
      return 1;
    }
  } catch {
    console.error(`factory fix: path not found: ${path}`);
    return 1;
  }

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)).`);
    return 1;
  }

  const token =
    options.token === null
      ? undefined
      : (options.token ?? resolveToken(flags.token));
  const ctx = buildContext(root, { token });

  let profile;
  let waivers;
  try {
    profile = await ctx.profile();
    waivers = await ctx.waivers();
  } catch (err) {
    if (
      err instanceof ProfileError ||
      err instanceof WaiverError ||
      err instanceof EvidenceError
    ) {
      console.error(`factory fix: ${err.message}`);
      return 1;
    }
    throw err;
  }

  // Which controls are candidates?
  let candidates: Control[];
  if (flags.control) {
    candidates = controls.filter((c) => c.id === flags.control);
    if (candidates.length === 0) {
      console.error(`factory fix: unknown control "${flags.control}".`);
      return 1;
    }
  } else {
    const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
    candidates = controls.filter(
      (c) =>
        (!flags.lane || c.lane === flags.lane) &&
        SEVERITIES.indexOf(c.severity) <= floorRank,
    );
  }

  const results = await evaluateControls(candidates, ctx, {
    now: options.now,
    profile,
    waivers,
  });

  let toFix = results.filter((r) => FIXABLE.has(r.status));
  if (flags.gate) {
    const { gates } = await loadBundledGates();
    const gate = gates.find((g) => g.phase === flags.gate);
    if (!gate) {
      console.error(`factory fix: unknown gate "${flags.gate}".`);
      return 1;
    }
    const inGate = new Set(
      selectForGate(gate, results).map((r) => r.controlId),
    );
    toFix = toFix.filter((r) => inGate.has(r.controlId));
  }

  const fixIds = new Set(toFix.map((r) => r.controlId));
  const controlsToFix = candidates.filter((c) => fixIds.has(c.id) && c.fix);

  const changes = await planControls(ctx, controlsToFix);
  const color = flags.color !== false && process.stdout.isTTY === true;

  if (flags.pr) {
    return runFixPr(ctx, changes, controlsToFix, flags, options, color);
  }

  const changeResults = await applyChanges(root, changes, {
    mode: flags.write ? "write" : "dry-run",
  });

  process.stdout.write(
    `${renderFixPlan(changeResults, Boolean(flags.write), color)}\n`,
  );
  return 0;
}

/** The `--pr` path: branch, commit-per-control, push, open/reuse a PR. */
async function runFixPr(
  ctx: ReturnType<typeof buildContext>,
  changes: Awaited<ReturnType<typeof planControls>>,
  controlsToFix: Control[],
  flags: FixFlags,
  options: RunFixOptions,
  color: boolean,
): Promise<number> {
  const titles = Object.fromEntries(controlsToFix.map((c) => [c.id, c.title]));
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  try {
    const result = await openFixPr(ctx, changes, {
      gate: flags.gate ?? "all",
      date: today,
      titles,
    });

    process.stdout.write(
      `${renderFixPlan(result.changeResults, true, color)}\n`,
    );
    if (result.pr) {
      const verb = result.pr.reused ? "Updated" : "Opened";
      process.stdout.write(
        `\n${verb} PR #${result.pr.number} (${result.commits.length} commit${
          result.commits.length === 1 ? "" : "s"
        }): ${result.pr.url}\n`,
      );
    } else {
      process.stdout.write(
        "\nNo changes to propose — no pull request opened.\n",
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof FixPrError) {
      console.error(`factory fix --pr: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
