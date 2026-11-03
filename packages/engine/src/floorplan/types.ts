// The "floor plan" repository model: a structured graph of a repo's architecture
// produced by the deep-audit swarm (see swarm.ts) and persisted as managed state
// in `.factory/floorplan.json` (ADR-0003). It is deliberately a plain data shape
// with no behaviour — the engine produces it, the desktop IPC boundary
// (apps/desktop/src/shared/ipc.ts) re-validates it with zod before the renderer
// draws it with Cytoscape, and `detected` feeds the Phase-2 profile proposals.

/** What a node represents in the architecture graph. */
export type FloorPlanNodeKind =
  | "system" // a top-level area (usually one slice / workspace package)
  | "subsystem" // a cohesive module within a system
  | "feature" // a user- or domain-facing capability
  | "service" // a long-running process / server
  | "api" // an exposed surface (HTTP route group, IPC channel set, CLI)
  | "connector" // glue between systems (adapter, bridge, client)
  | "datastore" // a database, cache, or on-disk state
  | "external" // a third-party dependency or SaaS the repo talks to
  | "package"; // a build/workspace package when no better kind fits

/** How one node relates to another. Drives the edges Cytoscape renders. */
export type FloorPlanEdgeKind =
  | "depends-on"
  | "calls"
  | "exposes"
  | "reads"
  | "writes"
  | "imports"
  | "deploys";

/** A single box on the floor plan. `parent` nests it inside a compound node. */
export interface FloorPlanNode {
  /** Stable, unique within a model. Slice-prefixed to avoid cross-slice clashes. */
  id: string;
  kind: FloorPlanNodeKind;
  title: string;
  /** One-line description shown in the detail panel. */
  summary: string;
  /** Representative files/directories (repo-relative) this node maps to. */
  paths: string[];
  /** Detected technologies (languages, frameworks, libraries). */
  tech?: string[];
  /** Parent node id for system → subsystem nesting (Cytoscape compound node). */
  parent?: string;
  /** Rough size signals, when a slice reports them. */
  metrics?: { files?: number; loc?: number };
}

/** A directed relationship between two nodes. */
export interface FloorPlanEdge {
  from: string;
  to: string;
  kind: FloorPlanEdgeKind;
  label?: string;
}

/** Facts the swarm inferred about the repo — surfaced as Phase-2 proposals. */
export interface DetectedProfile {
  /** Catalog project type (web-app, api, cli, library, …), when confident. */
  type?: string;
  /** Languages/tools the repo is built with. */
  stack: string[];
  /** Risk flags the swarm believes apply (uses-ai, handles-pii, multi-service, …). */
  flags: Record<string, boolean>;
  /** Inferred lifecycle phase (scaffold, build, harden, …), when confident. */
  phase?: string;
  /** 0–1 self-rated confidence in the above. */
  confidence: number;
}

/** The raw per-slice agent output retained for incremental refresh and debugging. */
export interface SliceReport {
  /** Slice key (e.g. "packages/engine"). */
  key: string;
  /** Node ids this slice contributed. */
  nodeIds: string[];
  /** Agent-reported notes, or an error string if the slice agent failed. */
  note?: string;
}

/** The persisted floor-plan model for one repo. */
export interface RepositoryModel {
  version: 1;
  /** ISO timestamp the model was produced. */
  generatedAt: string;
  repoPath: string;
  /** git HEAD at scan time; drives the staleness check (store.isStale). */
  commit?: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    systemCount: number;
    /** True when at least one slice agent failed — the model is partial. */
    partial: boolean;
  };
  nodes: FloorPlanNode[];
  edges: FloorPlanEdge[];
  detected: DetectedProfile;
  slices: SliceReport[];
}

/** Progress emitted as the swarm runs, streamed to the renderer. */
export interface SwarmProgress {
  phase: "slice" | "map" | "reduce" | "done";
  message: string;
  /** Units completed in the current phase. */
  done: number;
  /** Total units in the current phase (0 when not applicable). */
  total: number;
}
