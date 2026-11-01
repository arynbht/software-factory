import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "./context.js";
import { runDetector } from "./detectors/run.js";
import type { DetectorResult } from "./detectors/types.js";

export type ControlStatus = "pass" | "fail" | "skip" | "needs-evidence";

export interface ControlResult {
  controlId: string;
  lane: Control["lane"];
  phase: Control["phase"];
  severity: Control["severity"];
  status: ControlStatus;
  detectors: DetectorResult[];
  durationMs: number;
}

/**
 * Run every detector of a control and aggregate a single status.
 *
 * Precedence: a single failing detector fails the control; otherwise a skipped
 * detector leaves it `skip` (undetermined); otherwise it passes. The
 * `needs-evidence` state is wired in when the `manual` detector lands (M1.6).
 */
export async function evaluateControl(
  control: Control,
  ctx: AuditContext,
): Promise<ControlResult> {
  const start = performance.now();

  const detectors: DetectorResult[] = [];
  for (const config of control.detect) {
    detectors.push(await runDetector(ctx, config));
  }

  return {
    controlId: control.id,
    lane: control.lane,
    phase: control.phase,
    severity: control.severity,
    status: aggregate(detectors),
    detectors,
    durationMs: Math.round(performance.now() - start),
  };
}

function aggregate(results: DetectorResult[]): ControlStatus {
  if (results.some((r) => r.status === "fail")) return "fail";
  if (results.some((r) => r.status === "skip")) return "skip";
  return "pass";
}
