// @arynbht/factory-engine
// Headless engine. Catalog loading, context building, detectors, gates,
// generators, GitHub client, AI, inference, and metrics land here from M1 on.
export const PACKAGE = "@arynbht/factory-engine" as const;

export { buildContext, QUIET_LOG, resolveRepoSlug } from "./context.js";
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
export {
  loadProfile,
  saveProfile,
  updateProfile,
  ProfileError,
} from "./profile.js";
export {
  appliesTo,
  evaluatePredicate,
  gatherRepoFacts,
  NO_FACTS,
  type RepoFacts,
} from "./applicability.js";
export {
  declaredStacks,
  detectStacks,
  type Stack,
  TEMPLATE_STACKS,
  type TemplateStack,
  templateStacks,
} from "./stack.js";
export {
  loadWaivers,
  addWaiver,
  findActiveWaiver,
  isWaiverActive,
  waiversExpiringWithin,
  WaiverError,
} from "./waivers.js";
export * from "./detectors/index.js";
export { computeMetrics } from "./metrics.js";
export type { Metrics, MetricsOptions } from "./metrics.js";
export { appendHistory, loadHistory, laneCounts } from "./history.js";
export type { HistoryEntry, LaneCount } from "./history.js";
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
export {
  claudeCliTransport,
  claudeCliAvailable,
  parseClaudeJson,
  type ClaudeCliOptions,
  type ClaudeRunner,
} from "./ai/claude-cli.js";
export { packContext } from "./ai/context.js";
export type { PackedContext, PackContextOptions } from "./ai/context.js";
export { isSensitivePath, looksLikeSecret } from "./ai/redact.js";
export {
  generateArtifact,
  loadPrompt,
  renderGeneratedFile,
  PromptError,
} from "./ai/generate.js";
export type {
  GenerateOptions,
  GenerateResult,
  PromptTemplate,
} from "./ai/generate.js";
export {
  gatherGitChangelogContext,
  gitChangelogSection,
  renderGitChangelogSection,
  simpleGitRunner,
} from "./ai/git-context.js";
export type {
  GitChangelogContext,
  GitCommit,
  GitRunner,
} from "./ai/git-context.js";
export {
  appendUsage,
  loadUsage,
  summarizeUsage,
  estimateCost,
} from "./ai/usage.js";
export type { UsageEntry, UsageSummary } from "./ai/usage.js";
// Deep-audit swarm + floor-plan model (the agentic repository map).
export { runSwarm, defaultListSlices } from "./floorplan/swarm.js";
export type { Slice, SwarmOptions, SwarmInvoke } from "./floorplan/swarm.js";
export { runAgent, extractJson, READ_ONLY_TOOLS } from "./floorplan/agent.js";
export type { AgentRunner, AgentSpec } from "./floorplan/agent.js";
export { loadFloorPlan, saveFloorPlan, isStale } from "./floorplan/store.js";
export { renderArchitectureDoc, saveArchitectureDoc } from "./floorplan/doc.js";
// Orchestration layer: feature/fix request → gated PR.
export { planFeature } from "./orchestrate/plan.js";
export type { PlanOptions } from "./orchestrate/plan.js";
export { runBuild, BuildError } from "./orchestrate/build.js";
export type { BuildOptions, GitOps } from "./orchestrate/build.js";
export { verify as verifyBuild } from "./orchestrate/verify.js";
export type { VerifyOptions, CommandRunner } from "./orchestrate/verify.js";
export {
  runWriteAgent,
  BUILD_TOOLS,
  agentEnv,
  DENIED_BUILD_TOOLS,
  ISOLATED_AGENT_ARGS,
  type WriteAgentRunner,
  type WriteAgentSpec,
} from "./orchestrate/write-agent.js";
export {
  createWorktree,
  removeWorktree,
  commitAll,
  pushBranch,
  currentBranch,
  type Worktree,
} from "./orchestrate/worktree.js";
export type {
  BuildPlan,
  BuildTask,
  BuildResult,
  BuildProgress,
  VerifyResult,
  VerifyCheck,
} from "./orchestrate/types.js";
export type {
  RepositoryModel,
  FloorPlanNode,
  FloorPlanEdge,
  FloorPlanNodeKind,
  FloorPlanEdgeKind,
  DetectedProfile,
  SliceReport,
  SwarmProgress,
} from "./floorplan/types.js";
export {
  DEFAULT_SUMMARY,
  loadQualityBaseline,
  QUALITY_FILE,
  type QualityBaseline,
  ratchetCoverageBaseline,
  readLineCoverage,
  readQualityFile,
} from "./quality.js";
