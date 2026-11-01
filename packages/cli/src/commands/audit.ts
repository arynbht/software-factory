import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadBundledCatalog } from "@arynbht/factory-catalog";
import {
  buildContext,
  type ControlResult,
  evaluateControls,
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

/** Run `factory audit`. Returns the process exit code. */
export async function runAudit(
  path: string,
  flags: AuditFlags,
): Promise<number> {
  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)):`);
    for (const err of errors) console.error(`  ${err.file}: ${err.message}`);
    return 1;
  }

  const selected = flags.lane
    ? controls.filter((c) => c.lane === flags.lane)
    : controls;

  const ctx = buildContext(path, { token: resolveToken(flags.token) });
  const results = await evaluateControls(selected, ctx);

  const format: "table" | "json" = flags.json
    ? "json"
    : (flags.format ?? "table");
  const output = renderReport(results, { format, color: flags.color ?? true });
  process.stdout.write(`${output}\n`);

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
