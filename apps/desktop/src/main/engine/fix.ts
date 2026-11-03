// Fix adapter: plan generator changes for a repo (dry-run), apply them locally,
// or open a PR — mirroring `factory fix`. Each action re-plans from scratch
// (planning is cheap and idempotent) so no non-serializable Change[] crosses IPC.
// Electron-free, so it unit-tests as plain functions.
import { loadBundledCatalog, SEVERITIES } from "@arynbht/factory-catalog";
import {
  applyChanges,
  buildContext,
  evaluateControls,
  openFixPr,
  planControls,
} from "@arynbht/factory-engine";

import type { FixPlan, FixPrOutcome } from "../../shared/ipc";

const FIXABLE = new Set(["fail", "needs-evidence", "skip"]);

async function planChanges(repoPath: string, token?: string) {
  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    throw new Error(
      `Catalog is invalid: ${errors[0]?.message ?? "unknown error"}`,
    );
  }
  const ctx = buildContext(repoPath, token ? { token } : {});
  const profile = await ctx.profile().catch(() => null);
  const waivers = await ctx.waivers().catch(() => []);

  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const candidates = controls.filter(
    (c) => SEVERITIES.indexOf(c.severity) <= floorRank,
  );
  const results = await evaluateControls(candidates, ctx, { profile, waivers });
  const toFix = new Set(
    results.filter((r) => FIXABLE.has(r.status)).map((r) => r.controlId),
  );
  const controlsToFix = candidates.filter((c) => toFix.has(c.id) && c.fix);

  const { changes, errors: genErrors } = await planControls(ctx, controlsToFix);
  return { ctx, changes, controlsToFix, genErrors };
}

export async function planFix(
  repoPath: string,
  token?: string,
): Promise<FixPlan> {
  const { ctx, changes, genErrors } = await planChanges(repoPath, token);
  const changeResults = await applyChanges(ctx.repoPath, changes, {
    mode: "dry-run",
  });
  return { changes: changeResults, generatorErrors: genErrors };
}

export async function applyFix(
  repoPath: string,
  token?: string,
): Promise<FixPlan> {
  const { ctx, changes, genErrors } = await planChanges(repoPath, token);
  const changeResults = await applyChanges(ctx.repoPath, changes, {
    mode: "write",
  });
  return { changes: changeResults, generatorErrors: genErrors };
}

export async function openFixPrForRepo(
  repoPath: string,
  date: string,
  token?: string,
): Promise<FixPrOutcome> {
  const { ctx, changes, controlsToFix } = await planChanges(repoPath, token);
  const titles = Object.fromEntries(controlsToFix.map((c) => [c.id, c.title]));
  const result = await openFixPr(ctx, changes, { gate: "all", date, titles });
  return {
    pr: result.pr
      ? {
          number: result.pr.number,
          url: result.pr.url,
          reused: result.pr.reused,
        }
      : null,
    commits: result.commits.length,
    pushed: result.pushed,
    changeResults: result.changeResults,
    skippedEffects: result.skippedEffects,
  };
}
