import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  loadBundledCatalog,
  loadBundledGates,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  buildContext,
  type ControlResult,
  evaluateControls,
  evaluateGate,
  type GateResult,
  evidenceExpiringWithin,
  loadState,
  ProfileError,
  resolveToken,
  saveState,
  WaiverError,
  waiversExpiringWithin,
} from "@arynbht/factory-engine";

import {
  exitCodeFor,
  renderGate,
  renderGatesGithub,
  renderGatesMarkdown,
  renderReport,
  type ReportFormat,
  summarize,
} from "../report.js";

export interface AuditFlags {
  json?: boolean;
  format?: ReportFormat;
  lane?: string;
  token?: string;
  color?: boolean;
  gate?: string;
}

export interface RunAuditOptions {
  /** Reference time for evidence expiry; defaults to now. */
  now?: Date | undefined;
  /**
   * Token override: a string to use it, `null` to force offline (skip API
   * checks), or `undefined` to resolve from flags/env/gh. Used by tests.
   */
  token?: string | null | undefined;
}

/** Run `factory audit`. Returns the process exit code. */
export async function runAudit(
  path: string,
  flags: AuditFlags,
  options: RunAuditOptions = {},
): Promise<number> {
  if (flags.json && flags.format && flags.format !== "json") {
    console.error(
      `factory audit: --json conflicts with --format ${flags.format}; use one (--json is shorthand for --format json).`,
    );
    return 1;
  }

  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) {
      console.error(`factory audit: not a directory: ${path}`);
      return 1;
    }
  } catch {
    console.error(`factory audit: path not found: ${path}`);
    return 1;
  }

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)):`);
    for (const err of errors) console.error(`  ${err.file}: ${err.message}`);
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
    if (err instanceof ProfileError || err instanceof WaiverError) {
      console.error(`factory audit: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const selected = controls.filter(
    (c) =>
      (!flags.lane || c.lane === flags.lane) &&
      SEVERITIES.indexOf(c.severity) <= floorRank,
  );

  const results = await evaluateControls(selected, ctx, {
    now: options.now,
    profile,
    waivers,
  });

  const format: ReportFormat = flags.json ? "json" : (flags.format ?? "table");
  const machine = format !== "table";
  // Honour --no-color, NO_COLOR, and non-TTY output; otherwise colourise.
  const color =
    flags.color !== false &&
    !process.env.NO_COLOR &&
    process.stdout.isTTY === true;

  // Evaluate the requested gate(s) up front so the output path can fold them
  // into the machine report instead of appending human text that corrupts it.
  let gateResults: GateResult[] | null = null;
  if (flags.gate) {
    const resolved = await resolveGates(flags.gate, results);
    if ("error" in resolved) {
      console.error(resolved.error);
      return 1;
    }
    gateResults = resolved.gates;
  }

  if (format === "json") {
    const payload: Record<string, unknown> = {
      summary: summarize(results),
      controls: results,
    };
    if (gateResults) {
      payload["gates"] = gateResults.map((g) => ({
        phase: g.phase,
        title: g.title ?? null,
        status: g.status,
      }));
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(results, { format, color })}\n`);
    if (gateResults) {
      if (format === "markdown") {
        process.stdout.write(`${renderGatesMarkdown(gateResults)}\n`);
      } else if (format === "github") {
        process.stdout.write(`${renderGatesGithub(gateResults)}\n`);
      } else {
        process.stdout.write("\n");
        for (const g of gateResults) {
          process.stdout.write(`${renderGate(g, color)}\n`);
        }
      }
    }
  }

  // Advisory expiry warnings: keep stdout clean for machine formats (stderr),
  // so piped JSON/markdown/github output stays valid.
  const warn = (msg: string): void => {
    (machine ? process.stderr : process.stdout).write(msg);
  };
  const asOf = options.now ?? new Date();
  const expiringWaivers = waiversExpiringWithin(waivers, 30, asOf);
  if (expiringWaivers.length > 0) {
    warn(
      `\n⚠ ${expiringWaivers.length} waiver(s) expiring within 30 days: ${expiringWaivers
        .map((w) => w.control)
        .join(", ")}\n`,
    );
  }

  const entries = await ctx.evidence().catch(() => []);
  const expiringEvidence = evidenceExpiringWithin(entries, 30, asOf);
  if (expiringEvidence.length > 0) {
    warn(
      `\n⚠ ${expiringEvidence.length} evidence entr${
        expiringEvidence.length === 1 ? "y" : "ies"
      } expiring within 30 days: ${expiringEvidence
        .map((e) => e.control)
        .join(", ")}\n`,
    );
  }

  await writeState(ctx.repoPath, results);

  if (gateResults) {
    return gateResults.some((g) => g.status === "red") ? 1 : 0;
  }
  return exitCodeFor(results);
}

/**
 * Resolve the requested gate(s) to their evaluated results, or an error message
 * (unknown gate name or invalid gate definitions).
 */
async function resolveGates(
  which: string,
  results: ControlResult[],
): Promise<{ gates: GateResult[] } | { error: string }> {
  const { gates, errors } = await loadBundledGates();
  if (errors.length > 0) {
    return {
      error: `Gate definitions are invalid (${errors.length} error(s)).`,
    };
  }

  if (which === "all") {
    return { gates: gates.map((g) => evaluateGate(g, results)) };
  }
  const gate = gates.find((g) => g.phase === which);
  if (!gate) {
    const known = gates.map((g) => g.phase).join(", ");
    return {
      error: `Unknown gate "${which}". Defined gates: ${known || "none"}.`,
    };
  }
  return { gates: [evaluateGate(gate, results)] };
}

async function writeState(
  repoPath: string,
  results: ControlResult[],
): Promise<void> {
  // Preserve the managed-file hash registry (written by `factory fix`) across audits.
  const state = await loadState(repoPath);
  state.version = 1;
  state.generatedAt = new Date().toISOString();
  state.summary = summarize(results);
  state.controls = results.map((r) => ({
    id: r.controlId,
    status: r.status,
    lane: r.lane,
    phase: r.phase,
    severity: r.severity,
  }));
  await saveState(repoPath, state);
}
