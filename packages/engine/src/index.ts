// @arynbht/factory-engine
// Headless engine. Catalog loading, context building, detectors, gates,
// generators, GitHub client, AI, inference, and metrics land here from M1 on.
export const PACKAGE = "@arynbht/factory-engine" as const;

export { buildContext } from "./context.js";
export type {
  AuditContext,
  BuildContextOptions,
  GitHubClient,
} from "./context.js";
export { evaluateControl } from "./evaluate.js";
export type {
  ControlResult,
  ControlStatus,
  EvaluateOptions,
} from "./evaluate.js";
export { evaluateControls } from "./audit.js";
export type { AuditOptions } from "./audit.js";
export { evaluateGate, selectForGate } from "./gates.js";
export type { GateResult, GateStatus } from "./gates.js";
export {
  findValidEvidence,
  isEvidenceValid,
  loadEvidence,
  addEvidence,
  evidenceExpiringWithin,
  hashFile,
  parseDuration,
} from "./evidence.js";
export type { EvidenceEntry } from "./evidence.js";
export { parseRepoSlug } from "./github/slug.js";
export type { RepoSlug } from "./github/slug.js";
export { resolveToken } from "./github/token.js";
export { loadProfile, saveProfile, ProfileError } from "./profile.js";
export { appliesTo, evaluatePredicate } from "./applicability.js";
export {
  loadWaivers,
  addWaiver,
  findActiveWaiver,
  isWaiverActive,
  waiversExpiringWithin,
  WaiverError,
} from "./waivers.js";
export * from "./detectors/index.js";
