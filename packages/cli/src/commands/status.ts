import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EFFORTS,
  loadBundledCatalog,
  loadBundledGates,
  PHASES,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  buildContext,
  type ControlResult,
  evaluateControls,
  evaluateGate,
  EvidenceError,
  type GateStatus,
  ProfileError,
  resolveToken,
  WaiverError,
} from "@arynbht/factory-engine";

import { renderStatus, type StatusReport } from "../report.js";

export interface StatusFlags {
  json?: boolean;
  token?: string;
  color?: boolean;
}

export interface RunStatusOptions {
  now?: Date | undefined;
  token?: string | null | undefined;
}

/**
 * `factory status` — infer the project phase (the lowest phase whose gate is not
 * green) and list what blocks progress, in severity then effort order.
 */
export async function runStatus(
  path: string,
  flags: StatusFlags,
  options: RunStatusOptions = {},
): Promise<number> {
  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) {
      console.error(`factory status: not a directory: ${path}`);
      return 1;
    }
  } catch {
    console.error(`factory status: path not found: ${path}`);
    return 1;
  }

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)):`);
    for (const err of errors) console.error(`  ${err.file}: ${err.message}`);
    return 1;
  }
  const { gates } = await loadBundledGates();

  const token =
    options.token === null
      ? undefined
      : (options.token ?? resolveToken(flags.token));
  const ctx = buildContext(root, { token, now: options.now });

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
      console.error(`factory status: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const results = await evaluateControls(controls, ctx, {
    now: options.now,
    profile,
    waivers,
  });

  // Evaluate each phase's gate (where one is defined), in phase order. A gate that
  // selects zero controls is "undefined for this profile", not a blocker — treat it
  // like an absent gate so it never pins phase inference (an empty discovery gate
  // must not make every repo look stuck at "discovery").
  const gateByPhase = new Map(gates.map((g) => [g.phase, g]));
  const perPhase = PHASES.map((p) => {
    const gate = gateByPhase.get(p.key);
    const evaluated = gate ? evaluateGate(gate, results) : null;
    return {
      phase: p.key,
      title: p.title,
      status:
        evaluated && evaluated.controls.length > 0 ? evaluated.status : null,
      gate,
    };
  });

  // Inferred phase = the lowest-order phase whose gate is defined and not green.
  const firstBlocked = perPhase.find((p) => p.status && p.status !== "green");
  const defined = perPhase.filter((p) => p.status);
  const allGreen = defined.length > 0 && !firstBlocked;

  const report: StatusReport = {
    inferredPhase: firstBlocked?.phase ?? (allGreen ? "operate" : null),
    allGreen,
    declaredPhase: profile?.phase ?? null,
    gates: perPhase
      .filter((p): p is typeof p & { status: GateStatus } => p.status !== null)
      .map((p) => ({ phase: p.phase, title: p.title, status: p.status })),
    blockers: firstBlocked?.gate
      ? blockersFor(evaluateGate(firstBlocked.gate, results).controls)
      : [],
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const color = flags.color !== false && process.stdout.isTTY === true;
  process.stdout.write(`${renderStatus(report, color)}\n`);
  return 0;
}

/** Blocking controls (fail / needs-evidence) ordered by severity then effort. */
function blockersFor(controls: ControlResult[]): StatusReport["blockers"] {
  return controls
    .filter((c) => c.status === "fail" || c.status === "needs-evidence")
    .map((c) => ({
      controlId: c.controlId,
      title: c.title,
      status: c.status,
      severity: c.severity,
      effort: c.effort ?? "medium",
    }))
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort),
    );
}
