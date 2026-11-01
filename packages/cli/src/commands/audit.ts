import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadBundledCatalog, SEVERITIES } from "@arynbht/factory-catalog";
import {
  buildContext,
  type ControlResult,
  evaluateControls,
  ProfileError,
  resolveToken,
} from "@arynbht/factory-engine";

import { exitCodeFor, renderReport, summarize } from "../report.js";

export interface AuditFlags {
  json?: boolean;
  format?: "table" | "json";
  lane?: string;
  token?: string;
  color?: boolean;
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
  try {
    profile = await ctx.profile();
  } catch (err) {
    if (err instanceof ProfileError) {
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

  await writeState(ctx.repoPath, results);
  return exitCodeFor(results);
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
