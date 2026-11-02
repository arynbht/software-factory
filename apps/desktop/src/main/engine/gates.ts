// Phase-gate adapter: compute each phase's gate status + blockers and the
// inferred phase (mirrors `factory status`), and apply waivers / evidence. Kept
// free of any electron import so it unit-tests as plain functions.
import {
  loadBundledCatalog,
  loadBundledGates,
  PHASES,
  SEVERITIES,
  type Waiver,
} from "@arynbht/factory-catalog";
import {
  addEvidence,
  addWaiver,
  buildContext,
  evaluateControls,
  evaluateGate,
  type EvidenceEntry,
} from "@arynbht/factory-engine";

import type { GateBlocker, GatePhase, GatesReport } from "../../shared/ipc";

export async function computeGates(
  repoPath: string,
  token?: string,
): Promise<GatesReport> {
  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    throw new Error(
      `Catalog is invalid: ${errors[0]?.message ?? "unknown error"}`,
    );
  }
  const { gates } = await loadBundledGates();

  const ctx = buildContext(repoPath, token ? { token } : {});
  const profile = await ctx.profile().catch(() => null);
  const waivers = await ctx.waivers().catch(() => []);

  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const selected = controls.filter(
    (c) => SEVERITIES.indexOf(c.severity) <= floorRank,
  );
  const results = await evaluateControls(selected, ctx, { profile, waivers });

  const gateByPhase = new Map(gates.map((g) => [g.phase, g]));
  const phases: Omit<GatePhase, "inferred">[] = PHASES.map((p) => {
    const gate = gateByPhase.get(p.key);
    const evaluated = gate ? evaluateGate(gate, results) : null;
    // A gate that selects no controls is "undefined for this profile", not a
    // blocker — treat it like an absent gate (status null) so phase inference
    // never pins every repo at an empty early phase.
    const status =
      evaluated && evaluated.controls.length > 0 ? evaluated.status : null;
    const blockers: GateBlocker[] = (evaluated?.controls ?? [])
      .filter((c) => c.status === "fail" || c.status === "needs-evidence")
      .map((c) => ({
        controlId: c.controlId,
        title: c.title,
        status: c.status as GateBlocker["status"],
        severity: c.severity,
      }));
    return { phase: p.key, title: p.title, status, blockers };
  });

  // Inferred phase = lowest-order phase whose gate is defined and not green.
  const firstBlocked = phases.find((p) => p.status && p.status !== "green");
  const anyDefined = phases.some((p) => p.status);
  const lastPhase = PHASES[PHASES.length - 1]?.key ?? null;
  const inferredPhase = firstBlocked?.phase ?? (anyDefined ? lastPhase : null);

  return {
    repoPath,
    inferredPhase,
    phases: phases.map((p) => ({ ...p, inferred: p.phase === inferredPhase })),
  };
}

export async function waiveControl(
  repoPath: string,
  waiver: Waiver,
  token?: string,
): Promise<GatesReport> {
  await addWaiver(repoPath, waiver);
  return computeGates(repoPath, token);
}

export async function attachEvidence(
  repoPath: string,
  entry: EvidenceEntry,
  token?: string,
): Promise<GatesReport> {
  await addEvidence(repoPath, entry);
  return computeGates(repoPath, token);
}
