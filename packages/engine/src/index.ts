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
  loadState,
  saveState,
  managedFileUnchanged,
  managedHash,
  normalizeContent,
  sha256,
} from "./state.js";
export type { FactoryState } from "./state.js";
export * from "./generators/index.js";
export {
  upsertStickyComment,
  upsertStatusIssue,
  FACTORY_MARKER,
  STATUS_ISSUE_TITLE,
} from "./ci.js";
export { Octokit } from "@octokit/rest";
export {
  findValidEvidence,
  isEvidenceValid,
  loadEvidence,
  addEvidence,
  evidenceExpiringWithin,
  hashFile,
  parseDuration,
  EvidenceError,
} from "./evidence.js";
export type { EvidenceEntry } from "./evidence.js";
export { parseRepoSlug } from "./github/slug.js";
export type { RepoSlug } from "./github/slug.js";
export { resolveToken } from "./github/token.js";
export { openOrReusePr } from "./github/pr.js";
export type { OpenPrParams, PrResult } from "./github/pr.js";
export { openFixPr, FixPrError } from "./fix-pr.js";
export type { FixPrOptions, FixPrResult } from "./fix-pr.js";
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
export {
  createAiClient,
  resolveAnthropicKey,
  AiError,
  AiKeyError,
  DEFAULT_MODEL,
} from "./ai/client.js";
export type {
  AiClient,
  AiClientOptions,
  AiTransport,
  AiUsage,
  CompleteParams,
  CompleteResult,
  TransportRequest,
} from "./ai/client.js";
export { packContext } from "./ai/context.js";
export type { PackedContext, PackContextOptions } from "./ai/context.js";
export { isSensitivePath, looksLikeSecret } from "./ai/redact.js";
