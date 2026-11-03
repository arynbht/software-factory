// The Floor Plan tab: an interactive Cytoscape graph of the repository model the
// deep-audit swarm produces (systems → subsystems → features → APIs → connectors →
// datastores, and how they connect). System nodes are compound (they visually
// contain their children). Clicking a node opens a detail panel. All rendering is
// local and bundled — no remote calls — so it stays within the app's strict CSP.
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { Boxes, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type {
  FloorPlanNode,
  FloorPlanProgress,
  RepositoryModel,
} from "../../shared/ipc";

/** A colour per node kind — fixed hex so Cytoscape doesn't need the CSS vars. */
const KIND_COLOR: Record<FloorPlanNode["kind"], string> = {
  system: "#0ea5e9",
  subsystem: "#6366f1",
  feature: "#22c55e",
  service: "#f59e0b",
  api: "#ec4899",
  connector: "#a855f7",
  datastore: "#14b8a6",
  external: "#64748b",
  package: "#94a3b8",
};

function toElements(model: RepositoryModel): ElementDefinition[] {
  const ids = new Set(model.nodes.map((n) => n.id));
  const nodes: ElementDefinition[] = model.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.title,
      kind: n.kind,
      color: KIND_COLOR[n.kind],
      // Only keep a parent that actually exists, else Cytoscape throws.
      ...(n.parent && ids.has(n.parent) ? { parent: n.parent } : {}),
    },
  }));
  const edges: ElementDefinition[] = model.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e, i) => ({
      data: {
        id: `e${i}`,
        source: e.from,
        target: e.to,
        label: e.label ?? e.kind,
      },
    }));
  return [...nodes, ...edges];
}

function Graph({
  model,
  onSelect,
}: {
  model: RepositoryModel;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cy = cytoscape({
      container,
      elements: toElements(model),
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: "#e2e8f0",
            "font-size": 11,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": "120px",
            width: "label",
            height: "label",
            padding: "8px",
            shape: "round-rectangle",
          },
        },
        {
          // Compound (parent/system) nodes: a translucent container, label on top.
          selector: ":parent",
          style: {
            "background-opacity": 0.12,
            "background-color": "data(color)",
            "border-width": 1,
            "border-color": "data(color)",
            "text-valign": "top",
            "font-size": 12,
            "font-weight": 600,
            padding: "16px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#475569",
            "target-arrow-color": "#475569",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 8,
            color: "#94a3b8",
            "text-background-color": "#0b0f17",
            "text-background-opacity": 0.8,
            "text-background-padding": "2px",
          },
        },
        {
          selector: "node:selected",
          style: { "border-width": 3, "border-color": "#38bdf8" },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        padding: 24,
        nodeDimensionsIncludeLabels: true,
      },
    });

    cy.on("tap", "node", (evt) => onSelect(evt.target.id() as string));
    cy.on("tap", (evt) => {
      if (evt.target === cy) onSelect(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [model, onSelect]);

  return (
    <div
      ref={containerRef}
      className="h-[520px] w-full rounded-lg border border-border bg-background/40"
    />
  );
}

export function FloorPlan({
  repoPath,
  running,
  version,
  onRefresh,
}: {
  repoPath: string;
  /** True while a swarm run kicked off anywhere (Run audit, Fix, …) is in flight. */
  running: boolean;
  /** Bumped by App after a run completes, so we reload the persisted model. */
  version: number;
  /** Ask App to (re)run the swarm for this repo. */
  onRefresh: () => void;
}) {
  const [model, setModel] = useState<RepositoryModel | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FloorPlanProgress | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load the persisted model on mount and whenever a run completes (version bump).
  useEffect(() => {
    let active = true;
    window.factory.floorplan.get(repoPath).then(
      (view) => {
        if (!active) return;
        setModel(view.model);
        setAvailable(view.deepAuditAvailable);
      },
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, [repoPath, version]);

  // Live swarm progress (a main → renderer push, regardless of who started it).
  useEffect(() => {
    const unsubscribe = window.factory.floorplan.onProgress(setProgress);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!running) setProgress(null);
  }, [running]);

  const selected = useMemo(
    () => model?.nodes.find((n) => n.id === selectedId) ?? null,
    [model, selectedId],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Floor Plan</h2>
          <p className="truncate text-xs text-muted-foreground">
            {model
              ? `${model.summary.systemCount} systems · ${model.summary.nodeCount} nodes · ${model.summary.edgeCount} links${
                  model.summary.partial ? " · partial" : ""
                }`
              : "A map of this repository's systems and how they connect."}
          </p>
        </div>
        <Button onClick={onRefresh} disabled={running || !available}>
          {running ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {running ? "Mapping…" : "Refresh floor plan"}
        </Button>
      </div>

      {!available && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Deep audit needs the Claude Code CLI. Sign in with{" "}
          <code>claude login</code> so the swarm can run on your subscription.
          The deterministic scorecard still works without it.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}
      {running && progress && (
        <p className="text-sm text-sky-300" aria-live="polite">
          {progress.message}
          {progress.total > 0 ? ` (${progress.done}/${progress.total})` : ""}
        </p>
      )}

      {model ? (
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <Graph model={model} onSelect={setSelectedId} />
          </div>
          {selected && (
            <Card className="w-72 shrink-0 space-y-2 p-4">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: KIND_COLOR[selected.kind] }}
                />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {selected.kind}
                </span>
              </div>
              <h3 className="text-sm font-semibold">{selected.title}</h3>
              {selected.summary && (
                <p className="text-xs text-muted-foreground">
                  {selected.summary}
                </p>
              )}
              {selected.tech && selected.tech.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.tech.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {selected.paths.length > 0 && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Paths
                  </p>
                  {selected.paths.map((p) => (
                    <p
                      key={p}
                      className="truncate font-mono text-[11px]"
                      title={p}
                    >
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      ) : (
        !running && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              No floor plan yet. Run an audit (or hit Refresh) to let the swarm
              map this repository.
            </p>
          </div>
        )
      )}
    </div>
  );
}
