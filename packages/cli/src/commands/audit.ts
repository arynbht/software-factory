import { mkdir, stat, writeFile } from "node:fs/promises";
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
  ProfileError,
  resolveToken,
  WaiverError,
  waiversExpiringWithin,
} from "@arynbht/factory-engine";

import { exitCodeFor, renderGate, renderReport, summarize } from "../report.js";

export interface AuditFlags {
  json?: boolean;
  format?: "table" | "json";
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

  const format: "table" | "json" = flags.json
    ? "json"
    : (flags.format ?? "table");
  // Honour --no-color, NO_COLOR, and non-TTY output; otherwise colourise.
  const color =
    flags.color !== false &&
    !process.env.NO_COLOR &&
    process.stdout.isTTY === true;
  process.stdout.write(`${renderReport(results, { format, color })}\n`);

  const asOf = options.now ?? new Date();
  const expiringWaivers = waiversExpiringWithin(waivers, 30, asOf);
  if (expiringWaivers.length > 0) {
    process.stdout.write(
      `\n⚠ ${expiringWaivers.length} waiver(s) expiring within 30 days: ${expiringWaivers
        .map((w) => w.control)
        .join(", ")}\n`,
    );
  }

  const entries = await ctx.evidence().catch(() => []);
  const expiringEvidence = evidenceExpiringWithin(entries, 30, asOf);
  if (expiringEvidence.length > 0) {
    process.stdout.write(
      `\n⚠ ${expiringEvidence.length} evidence entr${
        expiringEvidence.length === 1 ? "y" : "ies"
      } expiring within 30 days: ${expiringEvidence
        .map((e) => e.control)
        .join(", ")}\n`,
    );
  }

  await writeState(ctx.repoPath, results);

  if (flags.gate) {
    return reportGates(flags.gate, results, color);
  }

  return exitCodeFor(results);
}

/**
 * Evaluate the requested gate(s), print their status, and return the exit code
 * (1 if any requested gate is red or the gate name was unknown).
 */
async function reportGates(
  which: string,
  results: ControlResult[],
  color: boolean,
): Promise<number> {
  const { gates, errors } = await loadBundledGates();
  if (errors.length > 0) {
    console.error(`Gate definitions are invalid (${errors.length} error(s)).`);
    return 1;
  }

  let selected: GateResult[];
  if (which === "all") {
    selected = gates.map((g) => evaluateGate(g, results));
  } else {
    const gate = gates.find((g) => g.phase === which);
    if (!gate) {
      const known = gates.map((g) => g.phase).join(", ");
      console.error(
        `Unknown gate "${which}". Defined gates: ${known || "none"}.`,
      );
      return 1;
    }
    selected = [evaluateGate(gate, results)];
  }

  process.stdout.write("\n");
  for (const gate of selected) {
    process.stdout.write(`${renderGate(gate, color)}\n`);
  }
  return selected.some((g) => g.status === "red") ? 1 : 0;
}

async function writeState(
  repoPath: string,
  results: ControlResult[],
): Promise<void> {
  const dir = resolve(repoPath, ".factory");
  await mkdir(dir, { recursive: true });
  const state = {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: summarize(results),
    controls: results.map((r) => ({
      id: r.controlId,
      status: r.status,
      lane: r.lane,
      phase: r.phase,
      severity: r.severity,
    })),
  };
  await writeFile(
    resolve(dir, "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}
