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
