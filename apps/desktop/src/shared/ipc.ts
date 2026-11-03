// The IPC contract shared by main, preload, and renderer. Every channel has a
// zod schema validated on BOTH sides: the main process re-validates each request
// it receives, and the preload re-validates each response before handing it to
// the renderer. The renderer only ever sees the typed `window.factory` surface
// (see preload) — never ipcRenderer, fs, git, or the network directly.
import { z } from "zod";

/** Allow-listed channel names. The preload exposes exactly these. */
export const IpcChannel = {
  Ping: "app:ping",
  ReposList: "repos:list",
  ReposAdd: "repos:add",
  ReposRemove: "repos:remove",
  AuditRun: "audit:run",
  AuthStatus: "auth:status",
  AuthSignIn: "auth:signIn",
  AuthSignOut: "auth:signOut",
  /** Push channel (main → renderer): sign-in progress after the device code. */
  AuthUpdate: "auth:update",
  ProfileLoad: "profile:load",
  ProfileSave: "profile:save",
  ProfileMeta: "profile:meta",
  SettingsLoad: "settings:load",
  SettingsSave: "settings:save",
  SettingsSetAnthropicKey: "settings:setAnthropicKey",
  UpdateCheck: "update:check",
  GatesStatus: "gates:status",
  GatesWaive: "gates:waive",
  GatesEvidence: "gates:evidence",
  FixPlan: "fix:plan",
  FixApply: "fix:apply",
  FixOpenPr: "fix:openPr",
  AiTasks: "ai:tasks",
  AiRun: "ai:run",
  AiApply: "ai:apply",
  AiOpenPr: "ai:openPr",
  DocsList: "docs:list",
  DocsRead: "docs:read",
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

// app:ping — a smoke round-trip proving the typed, validated bridge works.
export const PingResponse = z.object({
  reply: z.string(),
  version: z.string(),
});
export type PingResponse = z.infer<typeof PingResponse>;

export const PingRequest = z.object({ message: z.string().min(1).max(200) });
export type PingRequest = z.infer<typeof PingRequest>;

// Repos — local repo folders the user has added (persisted in userData).
export const RepoEntry = z.object({
  /** Absolute path to the repo on disk. */
  path: z.string(),
  /** Display name (folder basename). */
  name: z.string(),
});
export type RepoEntry = z.infer<typeof RepoEntry>;

export const RepoList = z.array(RepoEntry);
export type RepoList = z.infer<typeof RepoList>;

export const RepoRemoveRequest = z.object({ path: z.string().min(1) });
export type RepoRemoveRequest = z.infer<typeof RepoRemoveRequest>;

// Audit — the lane scorecard for one repo.
export const ControlStatus = z.enum([
  "pass",
  "fail",
  "skip",
  "needs-evidence",
  "waived",
  "n/a",
]);
export type ControlStatus = z.infer<typeof ControlStatus>;

const StatusCounts = z.object({
  pass: z.number().int(),
  fail: z.number().int(),
  needsEvidence: z.number().int(),
  waived: z.number().int(),
  skip: z.number().int(),
  na: z.number().int(),
});
export type StatusCounts = z.infer<typeof StatusCounts>;

export const ControlReference = z.object({
  name: z.string(),
  url: z.string(),
  section: z.string().optional(),
});

export const ScorecardControl = z.object({
  controlId: z.string(),
  title: z.string(),
  status: ControlStatus,
  severity: z.string(),
  message: z.string(),
  rationale: z.string(),
  references: z.array(ControlReference),
});
export type ScorecardControl = z.infer<typeof ScorecardControl>;

export const ScorecardLane = z.object({
  key: z.string(),
  title: z.string(),
  counts: StatusCounts,
  controls: z.array(ScorecardControl),
});
export type ScorecardLane = z.infer<typeof ScorecardLane>;

export const Scorecard = z.object({
  repoPath: z.string(),
  /** ISO timestamp the audit was produced. */
  generatedAt: z.string(),
  totals: StatusCounts.extend({ total: z.number().int() }),
  lanes: z.array(ScorecardLane),
});
export type Scorecard = z.infer<typeof Scorecard>;

export const AuditRunRequest = z.object({ repoPath: z.string().min(1) });
export type AuditRunRequest = z.infer<typeof AuditRunRequest>;

// Auth — GitHub device-flow sign-in. The token lives in the main process
// (safeStorage) and never crosses IPC; the renderer only learns who is signed in.
export const AuthStatus = z.object({
  signedIn: z.boolean(),
  login: z.string().nullable(),
});
export type AuthStatus = z.infer<typeof AuthStatus>;

/** auth:signIn response — what to show the user to complete the device flow. */
export const DeviceCodeInfo = z.object({
  userCode: z.string(),
  verificationUri: z.string(),
  expiresIn: z.number().int(),
});
export type DeviceCodeInfo = z.infer<typeof DeviceCodeInfo>;

/** auth:update push payload — the outcome of the background token poll. */
export const AuthUpdate = z.discriminatedUnion("status", [
  z.object({ status: z.literal("signed-in"), login: z.string() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type AuthUpdate = z.infer<typeof AuthUpdate>;

// Profile — the form is driven by this metadata (the catalog's enum lists), so
// the renderer never imports the catalog (which pulls node:fs). The profile
// object itself is validated by the engine on load/save, not at this boundary.
const LabeledKey = z.object({ key: z.string(), title: z.string() });

export const ProfileMeta = z.object({
  types: z.array(z.string()),
  phases: z.array(LabeledKey),
  flags: z.array(z.string()),
  lanes: z.array(LabeledKey),
  severities: z.array(z.string()),
});
export type ProfileMeta = z.infer<typeof ProfileMeta>;

export const ProfileLoadRequest = z.object({ repoPath: z.string().min(1) });
export const ProfileSaveRequest = z.object({
  repoPath: z.string().min(1),
  profile: z.unknown(),
});

/**
 * Loose boundary check for profile:load / profile:save. The engine validates the
 * full profile schema on load/save; this only confirms the IPC boundary returned
 * an object (or null, for a repo with no profile) rather than something unexpected.
 * We can't validate the full schema here — the catalog's ProfileSchema pulls
 * node:fs, which the sandboxed preload can't import.
 */
export const ProfileResponse = z.record(z.string(), z.unknown()).nullable();

// Gates — the phase gates for a repo, the inferred phase, and what blocks each.
export const GateStatus = z.enum(["green", "amber", "red"]);
export type GateStatus = z.infer<typeof GateStatus>;

export const GateBlocker = z.object({
  controlId: z.string(),
  title: z.string(),
  status: z.enum(["fail", "needs-evidence"]),
  severity: z.string(),
});
export type GateBlocker = z.infer<typeof GateBlocker>;

export const GatePhase = z.object({
  phase: z.string(),
  title: z.string(),
  status: GateStatus.nullable(),
  inferred: z.boolean(),
  blockers: z.array(GateBlocker),
});
export type GatePhase = z.infer<typeof GatePhase>;

export const GatesReport = z.object({
  repoPath: z.string(),
  inferredPhase: z.string().nullable(),
  phases: z.array(GatePhase),
});
export type GatesReport = z.infer<typeof GatesReport>;

export const GatesStatusRequest = z.object({ repoPath: z.string().min(1) });

export const WaiveRequest = z.object({
  repoPath: z.string().min(1),
  control: z.string().min(1),
  reason: z.string().min(1),
  /** ISO date YYYY-MM-DD. */
  expires: z.string().min(1),
  owner: z.string().optional(),
});
export type WaiveRequest = z.infer<typeof WaiveRequest>;

export const EvidenceRequest = z.object({
  repoPath: z.string().min(1),
  control: z.string().min(1),
  url: z.string().optional(),
  note: z.string().optional(),
  reviewer: z.string().optional(),
  validFor: z.string().optional(),
});
export type EvidenceRequest = z.infer<typeof EvidenceRequest>;

// Fix — proposed generator changes (dry-run or applied) and the PR outcome.
export const FixChange = z.object({
  controlId: z.string(),
  type: z.enum(["file", "effect"]),
  action: z.enum([
    "create",
    "update",
    "skip",
    "unchanged",
    "suggest",
    "effect",
  ]),
  path: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  message: z.string(),
  error: z.string().optional(),
});
export type FixChange = z.infer<typeof FixChange>;

export const FixPlan = z.object({
  changes: z.array(FixChange),
  generatorErrors: z.array(
    z.object({
      controlId: z.string(),
      fixType: z.string(),
      message: z.string(),
    }),
  ),
});
export type FixPlan = z.infer<typeof FixPlan>;

export const FixPrOutcome = z.object({
  pr: z
    .object({ number: z.number(), url: z.string(), reused: z.boolean() })
    .nullable(),
  commits: z.number().int(),
  pushed: z.boolean(),
  changeResults: z.array(FixChange),
  skippedEffects: z.number().int(),
});
export type FixPrOutcome = z.infer<typeof FixPrOutcome>;

export const FixPlanRequest = z.object({ repoPath: z.string().min(1) });

// AI — Claude-drafted artifacts (runs on the subscription CLI by default).
export const AiTaskInfo = z.object({ task: z.string(), output: z.string() });
export type AiTaskInfo = z.infer<typeof AiTaskInfo>;
export const AiTasks = z.array(AiTaskInfo);

export const AiRunResult = z.object({
  task: z.string(),
  outputPath: z.string(),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** API-equivalent cost estimate (subscription runs aren't metered per token). */
  costUsd: z.number(),
  includedFiles: z.array(z.string()),
  truncated: z.boolean(),
  /** The drafted artifact (not yet written — apply or open a PR to persist it). */
  contents: z.string(),
});
export type AiRunResult = z.infer<typeof AiRunResult>;

export const AiRunRequest = z.object({
  repoPath: z.string().min(1),
  task: z.string().min(1),
});
export const AiApplyRequest = z.object({
  repoPath: z.string().min(1),
  task: z.string().min(1),
  outputPath: z.string().min(1),
  contents: z.string(),
});
export type AiApplyRequest = z.infer<typeof AiApplyRequest>;

export const AiApplyResult = z.object({
  action: z.string(),
  path: z.string(),
});

// Docs — Markdown files under docs/ and .factory/, rendered (with Mermaid).
export const DocEntry = z.object({ path: z.string(), name: z.string() });
export type DocEntry = z.infer<typeof DocEntry>;
export const DocList = z.array(DocEntry);

export const DocsListRequest = z.object({ repoPath: z.string().min(1) });
export const DocsReadRequest = z.object({
  repoPath: z.string().min(1),
  path: z.string().min(1),
});
export const DocContent = z.object({
  path: z.string(),
  markdown: z.string(),
});
export type DocContent = z.infer<typeof DocContent>;

// Settings — personal preferences in `userData` (never the repo). The Anthropic
// API key is NOT in this object: like the GitHub token it lives in safeStorage and
// never crosses IPC — the renderer only learns whether one is set.
export const Theme = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof Theme>;

export const Settings = z.object({
  /** UI theme; "system" follows the OS preference. */
  theme: Theme,
  /** Default GitHub org, prefilled where an owner is needed. */
  defaultOrg: z.string(),
  /** Force the metered Anthropic API over the Claude CLI for AI tasks. */
  aiPreferApiKey: z.boolean(),
  /** Check for a newer release on launch. */
  autoCheckUpdates: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

/** What the renderer sees: the settings plus whether an Anthropic key is stored. */
export const SettingsView = Settings.extend({
  anthropicKeySet: z.boolean(),
});
export type SettingsView = z.infer<typeof SettingsView>;

/** A partial update — only the provided fields change. */
export const SettingsSaveRequest = Settings.partial();
export type SettingsSaveRequest = z.infer<typeof SettingsSaveRequest>;

/** Set (non-empty) or clear (empty string) the stored Anthropic key. */
export const AnthropicKeyRequest = z.object({ key: z.string() });
export type AnthropicKeyRequest = z.infer<typeof AnthropicKeyRequest>;

// Update check — queries the GitHub Releases API with the user's token (ADR-0010
// private-repo path), so it works for a private release repo electron-updater can't.
export const UpdateInfo = z.object({
  currentVersion: z.string(),
  /** The latest published release's version, or null if none / unreachable. */
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  /** The release (or download) page to open; null when there's no release. */
  url: z.string().nullable(),
  /** ISO publish date of the latest release, when known. */
  publishedAt: z.string().nullable(),
});
export type UpdateInfo = z.infer<typeof UpdateInfo>;
