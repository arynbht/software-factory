// The planner: turn a natural-language feature/fix request into a BuildPlan the user
// approves before any code is written. It runs a READ-ONLY agent (the audit agent
// from floorplan/agent.ts) grounded in the floor plan, so the plan routes work to the
// right systems and names concrete files/acceptance criteria.
import { type AgentSpec, runAgent } from "../floorplan/agent.js";
import { loadFloorPlan } from "../floorplan/store.js";
import type { AuditContext } from "../context.js";
import type { BuildPlan, BuildTask } from "./types.js";

export interface PlanOptions {
  /** Inject the agent call (tests). Default runs the read-only audit agent. */
  planner?: (spec: AgentSpec) => Promise<unknown>;
  model?: string;
  signal?: AbortSignal;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** A compact architecture summary from the floor plan, to ground the planner. */
async function architectureSummary(repoPath: string): Promise<string> {
  const model = await loadFloorPlan(repoPath);
  if (!model)
    return "No floor plan yet — run an audit first for better routing.";
  const title = new Map(model.nodes.map((n) => [n.id, n.title] as const));
  const systems = model.nodes.filter((n) => n.kind === "system");
  const lines = systems.slice(0, 20).map((s) => {
    const children = model.nodes
      .filter((n) => n.parent === s.id)
      .slice(0, 8)
      .map((c) => `${c.title} (${c.kind})`);
    return `- ${s.title}${children.length ? `: ${children.join(", ")}` : ""}`;
  });
  const edges = model.edges
    .filter((e) => e.from.startsWith("system:") && e.to.startsWith("system:"))
    .slice(0, 30)
    .map(
      (e) =>
        `${title.get(e.from) ?? e.from} —${e.kind}→ ${title.get(e.to) ?? e.to}`,
    );
  return [
    "Systems:",
    ...lines,
    ...(edges.length
      ? ["", "Connections:", ...edges.map((e) => `- ${e}`)]
      : []),
  ].join("\n");
}

const PLAN_SYSTEM = [
  "You are a senior engineer planning a change to a repository. Explore the code with Read/Grep/Glob to ground the plan in what actually exists — do NOT write anything.",
  "Produce a concrete, reviewable plan: which systems it touches, the approach, a short ordered task list naming the files each task changes, acceptance criteria, and risks.",
  "Reply with ONLY a JSON object (no prose, no code fence):",
  '{"summary":string,"affectedSystems":[string],"tasks":[{"title":string,"detail":string,"paths":[string]}],"acceptanceCriteria":[string],"risks":[string]}',
  "Keep it to the smallest correct change. Prefer touching existing files over adding new ones.",
].join("\n");

/** Normalize the planner's fuzzy reply into a BuildPlan. */
function normalize(request: string, raw: unknown): BuildPlan {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const tasks: BuildTask[] = (Array.isArray(obj.tasks) ? obj.tasks : [])
    .map((t) => {
      const tt = (t ?? {}) as Record<string, unknown>;
      return {
        title: asString(tt.title),
        detail: asString(tt.detail),
        paths: asStringArray(tt.paths),
      };
    })
    .filter((t) => t.title || t.detail);
  return {
    request,
    summary: asString(obj.summary),
    affectedSystems: asStringArray(obj.affectedSystems),
    tasks,
    acceptanceCriteria: asStringArray(obj.acceptanceCriteria),
    risks: asStringArray(obj.risks),
  };
}

/** Plan a feature/fix: explore the repo (read-only), grounded in the floor plan. */
export async function planFeature(
  ctx: AuditContext,
  description: string,
  options: PlanOptions = {},
): Promise<BuildPlan> {
  const planner = options.planner ?? ((spec: AgentSpec) => runAgent(spec));
  const arch = await architectureSummary(ctx.repoPath);
  const raw = await planner({
    cwd: ctx.repoPath,
    system: PLAN_SYSTEM,
    prompt: [
      `# Request`,
      description,
      "",
      `# Repository architecture (floor plan)`,
      arch,
    ].join("\n"),
    ...(options.model ? { model: options.model } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return normalize(description, raw);
}
