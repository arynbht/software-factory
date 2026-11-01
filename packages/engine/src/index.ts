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
export type { ControlResult, ControlStatus } from "./evaluate.js";
export { parseRepoSlug } from "./github/slug.js";
export type { RepoSlug } from "./github/slug.js";
export { resolveToken } from "./github/token.js";
export * from "./detectors/index.js";
