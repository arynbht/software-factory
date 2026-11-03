// The deep-audit swarm: a map/reduce fan-out of read-only Claude agents that turns
// a repository into a structured floor-plan model (see types.ts). It never mutates
// the repo. The design is deterministic where it can be and agentic where it must
// be:
//
//   1. slice  — deterministically split the repo into areas (workspace packages +
//               top-level source dirs). A reliable spine that needs no model.
//   2. map    — one agent per slice explores that slice and returns its subsystems,
//               features, APIs, connectors, datastores and intra-slice edges.
//   3. reduce — a deterministic merge of all slice nodes, then one agent resolves
//               cross-system connections and infers the project profile.
//   4. verify — (opt-in) a reviewer agent prunes implausible cross-system edges, so
//               the reduce step isn't trusted single-pass.
//
// Incremental refresh: each slice carries a content fingerprint. Given the previous
// model, slices whose fingerprint is unchanged are REUSED verbatim (no agent run);
// only changed/new slices are re-mapped, and the reduce is skipped entirely when
// nothing changed. This is what keeps repeated refreshes cheap.
//
// Every model call goes through an injectable seam (`invoke`), so the whole
// pipeline is unit-tested with canned payloads and no `claude` process. Slice
// discovery, fingerprinting, and the git HEAD read are injectable for the same
// reason.
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runTool } from "../detectors/exec.js";
import { type AgentRunner, type AgentSpec, runAgent } from "./agent.js";
import {
  type DetectedProfile,
  type FloorPlanEdge,
  type FloorPlanEdgeKind,
  type FloorPlanNode,
  type FloorPlanNodeKind,
  type RepositoryModel,
  type SliceReport,
  type SwarmProgress,
} from "./types.js";

/** A deterministically-chosen area of the repo handed to one map agent. */
export interface Slice {
  /** Stable key, also the node-id prefix (e.g. "packages/engine"). */
  key: string;
  /** Human title for the system node. */
  title: string;
  /** Repo-relative directory the agent explores. */
  dir: string;
}

/** The seam the swarm calls per agent; the default runs a real read-only agent. */
export type SwarmInvoke = (
  spec: AgentSpec & { role: "map" | "reduce" | "verify"; slice?: Slice },
) => Promise<unknown>;

export interface SwarmOptions {
  /** Inject canned agent replies (tests). Omit to spawn real agents. */
  invoke?: SwarmInvoke;
  /** Low-level runner passed to the default invoke (tests may stub this instead). */
  runner?: AgentRunner;
  /** Max agents in flight (default 4) — bounded to respect subscription limits. */
  concurrency?: number;
  model?: string;
  onProgress?: (p: SwarmProgress) => void;
  signal?: AbortSignal;
  /** Override slice discovery (tests). */
  listSlices?: (repoPath: string) => Promise<Slice[]>;
  /** Override the git HEAD read (tests). */
  gitHead?: (repoPath: string) => Promise<string | undefined>;
  /** Override per-slice fingerprinting (tests). */
  fingerprint?: (repoPath: string, slice: Slice) => Promise<string>;
  /** The prior model, enabling incremental reuse of unchanged slices. */
  previous?: RepositoryModel | null;
  /** Run the (extra, bounded) verification pass over cross-system edges. */
  verify?: boolean;
  /** Cap on slices analyzed (default 12) to bound cost; extras are dropped. */
  maxSlices?: number;
  /** For deterministic timestamps in tests. */
  now?: () => Date;
}

const NODE_KINDS = new Set<FloorPlanNodeKind>([
  "system",
  "subsystem",
  "feature",
  "service",
  "api",
  "connector",
  "datastore",
  "external",
  "package",
]);
const EDGE_KINDS = new Set<FloorPlanEdgeKind>([
  "depends-on",
  "calls",
  "exposes",
  "reads",
  "writes",
  "imports",
  "deploys",
]);

/** Directory names never worth slicing. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".factory",
  "dist",
  "out",
  "build",
  ".turbo",
  ".next",
  "coverage",
  ".vite",
  ".cache",
]);

// ---------------------------------------------------------------------------
// Slice discovery (deterministic)
// ---------------------------------------------------------------------------

async function subdirs(abs: string): Promise<string[]> {
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Split the repo into slices: expand monorepo containers (`packages/*`, `apps/*`)
 * one level, and treat other top-level source dirs as their own slice. Falls back
 * to a single whole-repo slice when there is no useful structure.
 */
export async function defaultListSlices(repoPath: string): Promise<Slice[]> {
  const slices: Slice[] = [];
  const top = await subdirs(repoPath);

  for (const name of top) {
    if (name === "packages" || name === "apps") {
      const children = await subdirs(resolve(repoPath, name));
      for (const child of children) {
        const key = `${name}/${child}`;
        slices.push({ key, title: child, dir: key });
      }
      // A container with no children still deserves a slice.
      if (children.length === 0) {
        slices.push({ key: name, title: name, dir: name });
      }
    } else {
      slices.push({ key: name, title: name, dir: name });
    }
  }

  if (slices.length === 0) {
    slices.push({ key: ".", title: "repository", dir: "." });
  }
  return slices;
}

async function defaultGitHead(repoPath: string): Promise<string | undefined> {
  try {
    const { exitCode, stdout } = await runTool(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
    );
    const head = stdout.trim();
    return exitCode === 0 && head ? head : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fingerprint a slice from its files' relative paths, sizes and mtimes — fast and
 * sensitive to any working-tree edit (unlike a commit hash, which misses unstaged
 * changes). Bounded so a pathological tree can't stall the scan.
 */
export async function fingerprintSlice(
  repoPath: string,
  slice: Slice,
): Promise<string> {
  const root = resolve(repoPath, slice.dir);
  const parts: string[] = [];
  let count = 0;
  const LIMIT = 4000;

  async function walk(abs: string, rel: string): Promise<void> {
    if (count >= LIMIT) return;
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (count >= LIMIT) return;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        await walk(join(abs, e.name), `${rel}${e.name}/`);
      } else if (e.isFile()) {
        try {
          const s = await stat(join(abs, e.name));
          parts.push(`${rel}${e.name}:${s.size}:${Math.floor(s.mtimeMs)}`);
          count += 1;
        } catch {
          // unreadable entry — skip
        }
      }
    }
  }

  await walk(root, "");
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

// ---------------------------------------------------------------------------
// Bounded-concurrency pool
// ---------------------------------------------------------------------------

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i] as T, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Normalization of fuzzy agent payloads
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
function nodeKind(v: unknown): FloorPlanNodeKind {
  return typeof v === "string" && NODE_KINDS.has(v as FloorPlanNodeKind)
    ? (v as FloorPlanNodeKind)
    : "subsystem";
}
function edgeKind(v: unknown): FloorPlanEdgeKind {
  return typeof v === "string" && EDGE_KINDS.has(v as FloorPlanEdgeKind)
    ? (v as FloorPlanEdgeKind)
    : "depends-on";
}
function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "node"
  );
}

interface MapPayload {
  system: { title: string; summary: string };
  nodes: FloorPlanNode[];
  edges: FloorPlanEdge[];
  signals: {
    type?: string;
    stack: string[];
    flags: Record<string, boolean>;
    phase?: string;
  };
}

/** Normalize one map agent's reply, prefixing ids so slices never collide. */
function normalizeMap(slice: Slice, raw: unknown): MapPayload {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const systemId = `system:${slice.key}`;
  const sys = (obj.system ?? {}) as Record<string, unknown>;

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  // First pass: assign prefixed ids and remember the raw→prefixed id mapping so
  // intra-slice parent/edge references can be rewritten.
  const idMap = new Map<string, string>();
  const nodes: FloorPlanNode[] = rawNodes.map((n, i) => {
    const nn = (n ?? {}) as Record<string, unknown>;
    const rawId = asString(nn.id) || slug(asString(nn.title)) || `n${i}`;
    const id = `${slice.key}/${rawId}`;
    idMap.set(rawId, id);
    idMap.set(id, id);
    const node: FloorPlanNode = {
      id,
      kind: nodeKind(nn.kind),
      title: asString(nn.title) || rawId,
      summary: asString(nn.summary),
      paths: asStringArray(nn.paths),
      ...(asStringArray(nn.tech).length
        ? { tech: asStringArray(nn.tech) }
        : {}),
    };
    // Default parent is the slice's system node; a reference to a sibling wins.
    const parentRef = asString(nn.parent);
    node.parent =
      parentRef && idMap.has(parentRef) ? idMap.get(parentRef)! : systemId;
    return node;
  });
  // Second pass fixes parents that referenced a sibling defined later.
  for (let i = 0; i < nodes.length; i++) {
    const parentRef = asString(
      (rawNodes[i] as Record<string, unknown>)?.parent,
    );
    if (
      parentRef &&
      idMap.has(parentRef) &&
      idMap.get(parentRef) !== nodes[i]!.id
    ) {
      nodes[i]!.parent = idMap.get(parentRef)!;
    }
  }

  const resolveId = (ref: unknown): string | undefined => {
    const r = asString(ref);
    return idMap.get(r) ?? (r === systemId ? systemId : undefined);
  };
  const edges: FloorPlanEdge[] = (Array.isArray(obj.edges) ? obj.edges : [])
    .map((e) => {
      const ee = (e ?? {}) as Record<string, unknown>;
      const from = resolveId(ee.from);
      const to = resolveId(ee.to);
      if (!from || !to || from === to) return null;
      const edge: FloorPlanEdge = { from, to, kind: edgeKind(ee.kind) };
      if (asString(ee.label)) edge.label = asString(ee.label);
      return edge;
    })
    .filter((e): e is FloorPlanEdge => e !== null);

  const sig = (obj.signals ?? {}) as Record<string, unknown>;
  const flags: Record<string, boolean> = {};
  if (sig.flags && typeof sig.flags === "object") {
    for (const [k, v] of Object.entries(sig.flags as Record<string, unknown>)) {
      if (typeof v === "boolean") flags[k] = v;
    }
  }

  return {
    system: {
      title: asString(sys.title) || slice.title,
      summary: asString(sys.summary),
    },
    nodes,
    edges,
    signals: {
      ...(asString(sig.type) ? { type: asString(sig.type) } : {}),
      stack: asStringArray(sig.stack),
      flags,
      ...(asString(sig.phase) ? { phase: asString(sig.phase) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const MAP_SYSTEM = [
  "You are a software-architecture analyst mapping ONE slice (a directory) of a repository for a 'floor plan' diagram.",
  "Explore only within the given directory using the Read, Grep and Glob tools. Do not guess; base everything on files you actually read.",
  "Identify the slice's most important subsystems, features, exposed APIs (HTTP routes, IPC channels, CLI commands), connectors/adapters, datastores, and external integrations — and the relationships among them.",
  "Reply with ONLY a JSON object (no prose, no code fence):",
  '{"system":{"title":string,"summary":string},"nodes":[{"id":string,"kind":"subsystem|feature|service|api|connector|datastore|external|package","title":string,"summary":string,"paths":[string],"tech":[string]}],"edges":[{"from":nodeId,"to":nodeId,"kind":"depends-on|calls|exposes|reads|writes|imports|deploys","label":string}],"signals":{"type":string,"stack":[string],"flags":{"uses-ai":boolean},"phase":string}}',
  "Keep nodes to the 3–12 most significant. paths are repo-relative. node ids are short and unique within this reply.",
].join("\n");

const REDUCE_SYSTEM = [
  "You are given the list of top-level systems of a repository (with their subsystems) discovered by per-slice analysis.",
  "Determine how the SYSTEMS connect to each other (which depends-on/calls/exposes/imports which), using the given system ids as edge endpoints, and infer the overall project profile.",
  "Reply with ONLY a JSON object (no prose, no code fence):",
  '{"edges":[{"from":systemId,"to":systemId,"kind":"depends-on|calls|exposes|reads|writes|imports|deploys","label":string}],"detected":{"type":"web-app|api|cli|library|mobile|desktop|data-pipeline|monorepo","stack":[string],"flags":{"uses-ai":boolean,"multi-service":boolean,"handles-pii":boolean,"open-source":boolean,"public-facing":boolean},"phase":"discovery|requirements|architecture|design|scaffold|build|harden|launch|operate","confidence":number}}',
].join("\n");

const VERIFY_SYSTEM = [
  "You are reviewing the inferred cross-system connections of a repository floor plan for plausibility.",
  "Given the systems and a numbered list of proposed edges, identify which edges are implausible or unsupported and should be dropped.",
  "Be conservative: only drop an edge you are fairly confident is wrong. Reply with ONLY a JSON object (no prose, no code fence):",
  '{"drop":[number],"confidence":number}',
  "where `drop` holds the indices (from the numbered list) of edges to remove, and `confidence` (0–1) is your overall trust in the remaining graph.",
].join("\n");

// ---------------------------------------------------------------------------
// Detected-profile merge
// ---------------------------------------------------------------------------

function mergeDetected(
  signals: MapPayload["signals"][],
  reduceDetected: Record<string, unknown> | undefined,
  previous: DetectedProfile | undefined,
): DetectedProfile {
  const stack = new Set<string>(previous?.stack ?? []);
  const flags: Record<string, boolean> = { ...(previous?.flags ?? {}) };
  const typeVotes = new Map<string, number>();
  for (const s of signals) {
    s.stack.forEach((t) => stack.add(t));
    for (const [k, v] of Object.entries(s.flags)) flags[k] = flags[k] || v;
    if (s.type) typeVotes.set(s.type, (typeVotes.get(s.type) ?? 0) + 1);
  }

  const rd = reduceDetected ?? {};
  for (const t of asStringArray(rd.stack)) stack.add(t);
  if (rd.flags && typeof rd.flags === "object") {
    for (const [k, v] of Object.entries(rd.flags as Record<string, unknown>)) {
      if (typeof v === "boolean") flags[k] = flags[k] || v;
    }
  }

  const topVote = [...typeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const type = asString(rd.type) || topVote || previous?.type;
  const phase = asString(rd.phase) || previous?.phase;
  const confidence =
    typeof rd.confidence === "number"
      ? Math.max(0, Math.min(1, rd.confidence))
      : (previous?.confidence ?? 0.5);

  return {
    ...(type ? { type } : {}),
    stack: [...stack],
    flags,
    ...(phase ? { phase } : {}),
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const isSystemId = (id: string): boolean => id.startsWith("system:");

/** One slice's resolved contribution, whether freshly mapped or reused. */
interface SliceOutcome {
  slice: Slice;
  fingerprint: string;
  systemNode: FloorPlanNode;
  childNodes: FloorPlanNode[];
  edges: FloorPlanEdge[];
  signals?: MapPayload["signals"];
  error?: string;
  reused: boolean;
}

/** Pull a slice's nodes + intra-slice edges out of the previous model. */
function reuseOutcome(
  previous: RepositoryModel,
  slice: Slice,
  prevReport: SliceReport,
  fingerprint: string,
): SliceOutcome {
  const ids = new Set(prevReport.nodeIds);
  const nodes = previous.nodes.filter((n) => ids.has(n.id));
  const systemNode = nodes.find((n) => n.id === `system:${slice.key}`) ??
    nodes.find((n) => n.kind === "system") ?? {
      id: `system:${slice.key}`,
      kind: "system" as const,
      title: slice.title,
      summary: "",
      paths: [slice.dir],
    };
  const childNodes = nodes.filter((n) => n.id !== systemNode.id);
  const edges = previous.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return {
    slice,
    fingerprint,
    systemNode,
    childNodes,
    edges,
    reused: true,
  };
}

/** Run the deep-audit swarm over a repo and return its floor-plan model. */
export async function runSwarm(
  repoPath: string,
  options: SwarmOptions = {},
): Promise<RepositoryModel> {
  const {
    concurrency = 4,
    model,
    onProgress,
    signal,
    maxSlices = 12,
    previous = null,
    verify = false,
    now = () => new Date(),
  } = options;
  const listSlices = options.listSlices ?? defaultListSlices;
  const gitHead = options.gitHead ?? defaultGitHead;
  const fingerprint = options.fingerprint ?? fingerprintSlice;
  // The default seam ignores role/slice (they're only there to help test stubs
  // branch) and runs a real read-only agent from the rest of the spec.
  const invoke: SwarmInvoke =
    options.invoke ?? ((spec) => runAgent(spec, options.runner));

  const report = (p: SwarmProgress): void => {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    onProgress?.(p);
  };

  // 1. Slice + fingerprint ---------------------------------------------------
  report({ phase: "slice", message: "Planning slices…", done: 0, total: 0 });
  const allSlices = await listSlices(repoPath);
  const slices = allSlices.slice(0, maxSlices);
  const dropped = allSlices.length - slices.length;

  const fingerprints = await mapPool(slices, concurrency, (s) =>
    fingerprint(repoPath, s),
  );
  const prevByKey = new Map(
    (previous?.slices ?? []).map((r) => [r.key, r] as const),
  );

  // Decide reuse vs re-map per slice.
  const outcomes = new Array<SliceOutcome | null>(slices.length).fill(null);
  const toRemap: { slice: Slice; index: number; fingerprint: string }[] = [];
  slices.forEach((slice, i) => {
    const fp = fingerprints[i]!;
    const prev = prevByKey.get(slice.key);
    if (previous && prev && !prev.note && prev.fingerprint === fp) {
      outcomes[i] = reuseOutcome(previous, slice, prev, fp);
    } else {
      toRemap.push({ slice, index: i, fingerprint: fp });
    }
  });
  const reusedCount = slices.length - toRemap.length;
  report({
    phase: "slice",
    message:
      `${slices.length} slices` +
      (reusedCount > 0 ? `, ${reusedCount} unchanged (reused)` : "") +
      (dropped > 0 ? `, dropped ${dropped} over the cap` : ""),
    done: slices.length,
    total: slices.length,
  });

  // 2. Map the changed/new slices (bounded concurrency) ----------------------
  let mapped = 0;
  const remapped = await mapPool(toRemap, concurrency, async (item) => {
    const { slice } = item;
    report({
      phase: "map",
      message: `Analyzing ${slice.key}…`,
      done: mapped,
      total: toRemap.length,
    });
    let outcome: SliceOutcome;
    try {
      const raw = await invoke({
        role: "map",
        slice,
        cwd: repoPath,
        system: MAP_SYSTEM,
        prompt: `Slice "${slice.key}" — directory \`${slice.dir}\`. Map it.`,
        ...(model ? { model } : {}),
        ...(signal ? { signal } : {}),
      });
      const payload = normalizeMap(slice, raw);
      outcome = {
        slice,
        fingerprint: item.fingerprint,
        systemNode: {
          id: `system:${slice.key}`,
          kind: "system",
          title: payload.system.title,
          summary: payload.system.summary,
          paths: [slice.dir],
        },
        childNodes: payload.nodes,
        edges: payload.edges,
        signals: payload.signals,
        reused: false,
      };
    } catch (err) {
      outcome = {
        slice,
        fingerprint: item.fingerprint,
        systemNode: {
          id: `system:${slice.key}`,
          kind: "system",
          title: slice.title,
          summary: `analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          paths: [slice.dir],
        },
        childNodes: [],
        edges: [],
        error: err instanceof Error ? err.message : String(err),
        reused: false,
      };
    } finally {
      mapped += 1;
      report({
        phase: "map",
        message: `Analyzed ${slice.key}`,
        done: mapped,
        total: toRemap.length,
      });
    }
    return outcome;
  });
  toRemap.forEach((item, k) => (outcomes[item.index] = remapped[k]!));

  // Assemble nodes/edges from all outcomes (reused + fresh), in slice order.
  const nodes: FloorPlanNode[] = [];
  const edges: FloorPlanEdge[] = [];
  const sliceReports: SliceReport[] = [];
  const systemIds: string[] = [];
  const systemSummaries: {
    id: string;
    title: string;
    summary: string;
    children: string[];
  }[] = [];
  const signals: MapPayload["signals"][] = [];
  let partial = false;

  for (const outcome of outcomes as SliceOutcome[]) {
    systemIds.push(outcome.systemNode.id);
    nodes.push(outcome.systemNode, ...outcome.childNodes);
    edges.push(...outcome.edges);
    if (outcome.signals) signals.push(outcome.signals);
    if (outcome.error) partial = true;
    sliceReports.push({
      key: outcome.slice.key,
      nodeIds: [outcome.systemNode.id, ...outcome.childNodes.map((n) => n.id)],
      fingerprint: outcome.fingerprint,
      ...(outcome.error ? { note: outcome.error } : {}),
      ...(outcome.reused ? { reused: true } : {}),
    });
    systemSummaries.push({
      id: outcome.systemNode.id,
      title: outcome.systemNode.title,
      summary: outcome.systemNode.summary,
      children: outcome.childNodes.map((n) => `${n.title} (${n.kind})`),
    });
  }

  // 3. Reduce ----------------------------------------------------------------
  // Skip the reduce agent entirely when every slice was reused: the cross-system
  // edges and detected profile from the previous model still hold.
  const nodeIds = new Set(nodes.map((n) => n.id));
  let detected: DetectedProfile;

  if (previous && toRemap.length === 0) {
    report({
      phase: "reduce",
      message: "All slices unchanged — reusing connections",
      done: 1,
      total: 1,
    });
    edges.push(
      ...previous.edges.filter(
        (e) =>
          isSystemId(e.from) &&
          isSystemId(e.to) &&
          nodeIds.has(e.from) &&
          nodeIds.has(e.to),
      ),
    );
    detected = mergeDetected([], undefined, previous.detected);
  } else {
    report({
      phase: "reduce",
      message: "Resolving connections…",
      done: 0,
      total: 1,
    });
    let reduceDetected: Record<string, unknown> | undefined;
    const crossEdges: FloorPlanEdge[] = [];
    try {
      const raw = (await invoke({
        role: "reduce",
        cwd: repoPath,
        system: REDUCE_SYSTEM,
        prompt: JSON.stringify({ systems: systemSummaries }),
        ...(model ? { model } : {}),
        ...(signal ? { signal } : {}),
      })) as Record<string, unknown>;
      reduceDetected = (raw?.detected as Record<string, unknown>) ?? undefined;
      for (const e of Array.isArray(raw?.edges) ? raw.edges : []) {
        const ee = (e ?? {}) as Record<string, unknown>;
        const from = asString(ee.from);
        const to = asString(ee.to);
        if (nodeIds.has(from) && nodeIds.has(to) && from !== to) {
          const edge: FloorPlanEdge = { from, to, kind: edgeKind(ee.kind) };
          if (asString(ee.label)) edge.label = asString(ee.label);
          crossEdges.push(edge);
        }
      }
    } catch (err) {
      partial = true;
      report({
        phase: "reduce",
        message: `Reduce failed: ${err instanceof Error ? err.message : String(err)}`,
        done: 1,
        total: 1,
      });
    }

    // 4. Verify (opt-in): prune implausible cross-system edges ----------------
    let keptCross = crossEdges;
    if (verify && crossEdges.length > 0) {
      report({
        phase: "reduce",
        message: "Verifying connections…",
        done: 1,
        total: 1,
      });
      try {
        const raw = (await invoke({
          role: "verify",
          cwd: repoPath,
          system: VERIFY_SYSTEM,
          prompt: JSON.stringify({
            systems: systemSummaries.map((s) => ({ id: s.id, title: s.title })),
            edges: crossEdges.map((e, i) => ({ i, ...e })),
          }),
          ...(model ? { model } : {}),
          ...(signal ? { signal } : {}),
        })) as Record<string, unknown>;
        const drop = new Set(
          (Array.isArray(raw?.drop) ? raw.drop : []).filter(
            (n): n is number => typeof n === "number",
          ),
        );
        keptCross = crossEdges.filter((_e, i) => !drop.has(i));
      } catch {
        // A failed verify leaves the edges as-is rather than dropping the model.
      }
    }
    edges.push(...keptCross);
    detected = mergeDetected(
      signals,
      reduceDetected,
      previous?.detected ?? undefined,
    );
  }

  const commit = await gitHead(repoPath);
  report({ phase: "done", message: "Floor plan ready", done: 1, total: 1 });

  return {
    version: 1,
    generatedAt: now().toISOString(),
    repoPath,
    ...(commit ? { commit } : {}),
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      systemCount: systemIds.length,
      partial,
    },
    nodes,
    edges,
    detected,
    slices: sliceReports,
  };
}
