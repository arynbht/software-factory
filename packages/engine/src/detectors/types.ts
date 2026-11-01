import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";

/**
 * A detector's verdict for a single `detect` entry.
 * - `pass`: the thing the control asks for is present/true.
 * - `fail`: it is absent/false.
 * - `skip`: the detector could not determine an answer (no token, tool missing,
 *   detector not implemented, or an error). Never counted as a pass.
 */
export type DetectorStatus = "pass" | "fail" | "skip";

export interface DetectorResult {
  status: DetectorStatus;
  message: string;
  remediation?: string | undefined;
}

/** A detector receives the context and a (type-erased) detector config. */
export type DetectorFn = (
  ctx: AuditContext,
  config: DetectorConfig,
) => Promise<DetectorResult>;
