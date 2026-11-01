import type { Control, Profile } from "@arynbht/factory-catalog";

import { appliesTo } from "./applicability.js";
import type { AuditContext } from "./context.js";
import { runDetector } from "./detectors/run.js";
import type { DetectorResult } from "./detectors/types.js";
import { findValidEvidence } from "./evidence.js";

export type ControlStatus = "pass" | "fail" | "skip" | "needs-evidence" | "n/a";

export interface ControlResult {
  controlId: string;
  title: string;
  lane: Control["lane"];
  phase: Control["phase"];
  severity: Control["severity"];
  status: ControlStatus;
  detectors: DetectorResult[];
  durationMs: number;
}

export interface EvaluateOptions {
  /** Reference time for evidence expiry; defaults to now. */
  now?: Date | undefined;
  /** Profile for applicability; null/undefined means every control applies. */
  profile?: Profile | null | undefined;
}

/**
 * Run a control's detectors and aggregate a single status.
 *
 * `manual` detectors are satisfied by human evidence (`.factory/evidence.yml`)
 * rather than an automated check: a valid, unexpired entry for the control passes
 * it; otherwise the control is `needs-evidence`.
 *
 * Precedence: a failing automated detector → `fail`; else unmet evidence →
 * `needs-evidence`; else any `skip` → `skip`; else `pass`.
 */
export async function evaluateControl(
  control: Control,
  ctx: AuditContext,
  options: EvaluateOptions = {},
): Promise<ControlResult> {
  const now = options.now ?? new Date();
  const start = performance.now();

  if (!appliesTo(control, options.profile ?? null)) {
    return {
      controlId: control.id,
      title: control.title,
      lane: control.lane,
      phase: control.phase,
      severity: control.severity,
      status: "n/a",
      detectors: [],
      durationMs: 0,
    };
  }

  const manualConfigs = control.detect.filter((c) => c.type === "manual");
  const autoConfigs = control.detect.filter((c) => c.type !== "manual");

  const autoResults: DetectorResult[] = [];
  for (const config of autoConfigs) {
    autoResults.push(await runDetector(ctx, config));
  }

  let manualResult: DetectorResult | null = null;
  let evidenceMissing = false;
  if (manualConfigs.length > 0) {
    // A broken/unreadable evidence file must not crash the run — treat it as no
    // evidence (needs-evidence) rather than letting the rejection escape.
    let entry = null;
    try {
      entry = findValidEvidence(await ctx.evidence(), control.id, now);
    } catch {
      entry = null;
    }
    if (entry) {
      manualResult = {
        status: "pass",
        message: `evidence by ${entry.reviewer ?? "unknown"}${
          entry.date ? ` on ${entry.date}` : ""
        }`,
      };
    } else {
      evidenceMissing = true;
      manualResult = {
        status: "skip",
        message: "awaiting human evidence (.factory/evidence.yml)",
      };
    }
  }

  const detectors = manualResult ? [...autoResults, manualResult] : autoResults;

  return {
    controlId: control.id,
    title: control.title,
    lane: control.lane,
    phase: control.phase,
    severity: control.severity,
    status: aggregate(autoResults, evidenceMissing, detectors),
    detectors,
    durationMs: Math.round(performance.now() - start),
  };
}

function aggregate(
  autoResults: DetectorResult[],
  evidenceMissing: boolean,
  allResults: DetectorResult[],
): ControlStatus {
  if (autoResults.some((r) => r.status === "fail")) return "fail";
  if (evidenceMissing) return "needs-evidence";
  if (allResults.some((r) => r.status === "skip")) return "skip";
  return "pass";
}
