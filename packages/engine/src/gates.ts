import {
  type Gate,
  type GateSelector,
  SEVERITIES,
} from "@arynbht/factory-catalog";

import type { ControlResult } from "./evaluate.js";

export type GateStatus = "green" | "amber" | "red";

export interface GateResult {
  phase: Gate["phase"];
  title: string | undefined;
  status: GateStatus;
  controls: ControlResult[];
}

function matchesSelector(
  result: ControlResult,
  selector: GateSelector,
): boolean {
  if (selector.id !== undefined) return result.controlId === selector.id;
  if (selector.lane !== undefined && result.lane !== selector.lane)
    return false;
  if (selector.phase !== undefined && result.phase !== selector.phase) {
    return false;
  }
  if (
    selector.minSeverity !== undefined &&
    SEVERITIES.indexOf(result.severity) >
      SEVERITIES.indexOf(selector.minSeverity)
  ) {
    return false;
  }
  return true;
}

/** The control results a gate selects (a result matches if it matches any selector). */
export function selectForGate(
  gate: Gate,
  results: ControlResult[],
): ControlResult[] {
  return results.filter((r) => gate.select.some((s) => matchesSelector(r, s)));
}

/**
 * A gate is red if any selected control failed; amber if none failed but some are
 * needs-evidence or skip (indeterminate); green if all pass, are n/a, or waived.
 */
export function evaluateGate(gate: Gate, results: ControlResult[]): GateResult {
  const controls = selectForGate(gate, results);
  let status: GateStatus = "green";
  if (controls.length === 0) {
    // A gate that matches nothing (e.g. a typo'd selector) is not "passing".
    status = "amber";
  } else if (controls.some((c) => c.status === "fail")) {
    status = "red";
  } else if (
    controls.some((c) => c.status === "needs-evidence" || c.status === "skip")
  ) {
    status = "amber";
  }
  return { phase: gate.phase, title: gate.title, status, controls };
}
