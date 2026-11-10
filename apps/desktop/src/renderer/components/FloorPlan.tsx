// The Floor Plan tab: an interactive Cytoscape graph of the repository model the
// deep-audit swarm produces (systems → subsystems → features → APIs → connectors →
// datastores, and how they connect). It defaults to a legible "systems only" view
// (one box per system) and can expand to the full detail graph; system nodes are
// compound (they visually contain their children). f-CoSE lays the graph out, and
// zoom/fit controls plus a details overlay keep it navigable even for big repos.
// All rendering is local and bundled — no remote calls — so it stays within the
// app's strict CSP.
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { Boxes, Maximize2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type {
  FloorPlanNode,
  FloorPlanProgress,
  RepositoryModel,
} from "../../shared/ipc";

// Register the f-CoSE layout once (guarded against HMR re-registration).
const w = window as unknown as { __fcoseRegistered?: boolean };
if (!w.__fcoseRegistered) {
  cytoscape.use(fcose);
  w.__fcoseRegistered = true;
}

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

/** Build Cytoscape elements. In "systems only" mode, show just the top-level
 *  system nodes and the links between them — far more legible for big repos. */
function toElements(
  model: RepositoryModel,
  detailed: boolean,
): ElementDefinition[] {
  const shown = detailed
    ? model.nodes
    : model.nodes.filter((n) => n.kind === "system");
  const ids = new Set(shown.map((n) => n.id));

  const nodes: ElementDefinition[] = shown.map((n) => ({
    data: {
      id: n.id,
      label: n.title,
      kind: n.kind,
      color: KIND_COLOR[n.kind],
      // Only keep a parent that's actually shown, else Cytoscape throws.
      ...(detailed && n.parent && ids.has(n.parent)
        ? { parent: n.parent }
        : {}),
    },
  }));

  const edges: ElementDefinition[] = model.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e, i) => ({
      data: { id: `e${i}`, source: e.from, target: e.to, kind: e.kind },
    }));
  return [...nodes, ...edges];
}

function Graph({
  elements,
  onSelect,
  onReady,
}: {
  elements: ElementDefinition[];
  onSelect: (id: string | null) => void;
  onReady: (cy: Core) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The latest callbacks, read through refs: the graph is rebuilt (and re-laid
  // out) only when the elements change, never because a parent re-rendered.
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  onSelectRef.current = onSelect;
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cy = cytoscape({
      container,
      elements,
      minZoom: 0.15,
      maxZoom: 2.5,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: "#e2e8f0",
            "font-size": 13,
            "font-weight": 500,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": "140px",
            // A dark pill behind the label keeps it readable over edges.
            "text-background-color": "#0b0f17",
            "text-background-opacity": 0.72,
            "text-background-shape": "roundrectangle",
            "text-background-padding": "3px",
            width: "label",
            height: "label",
            padding: "12px",
            shape: "roundrectangle",
          },
        },
        {
          // Compound (system) nodes: a translucent container, bold label on top.
          selector: ":parent",
          style: {
            "background-opacity": 0.1,
            "background-color": "data(color)",
            "border-width": 1.5,
            "border-color": "data(color)",
            "text-valign": "top",
            "font-size": 14,
            "font-weight": 700,
            "text-background-opacity": 0,
            padding: "22px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#475569",
            "line-opacity": 0.7,
            "target-arrow-color": "#475569",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.9,
            "curve-style": "bezier",
          },
        },
        {
          selector: "node:selected",
          style: { "border-width": 3, "border-color": "#38bdf8" },
        },
        {
          // Spotlight a selected edge's kind without cluttering every edge.
          selector: "edge:selected",
          style: {
            "line-color": "#38bdf8",
            "target-arrow-color": "#38bdf8",
            "line-opacity": 1,
            label: "data(kind)",
            "font-size": 10,
            color: "#bae6fd",
          },
        },
      ],
      layout: {
        name: "fcose",
        quality: "default",
        animate: false,
        randomize: true,
        fit: true,
        padding: 40,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 140,
        nodeSeparation: 140,
        nodeRepulsion: 9000,
        packComponents: true,
        tile: true,
      } as unknown as cytoscape.LayoutOptions,
    });

    cy.on("tap", "node", (evt) =>
      onSelectRef.current(evt.target.id() as string),
    );
    cy.on("tap", (evt) => {
      if (evt.target === cy) onSelectRef.current(null);
    });

    onReadyRef.current(cy);
    return () => {
      cy.destroy();
    };
  }, [elements]);

  return (
    <div
      ref={containerRef}
      className="h-[72vh] min-h-[480px] w-full rounded-lg border border-border bg-background/40"
    />
  );
}

/** A compact color key so the node kinds are readable at a glance. */
function Legend({ kinds }: { kinds: FloorPlanNode["kind"][] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {kinds.map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: KIND_COLOR[k] }}
          />
          {k}
        </span>
      ))}
    </div>
  );
}

export function FloorPlan({
  repoPath,
  running,
  version,
  runError,
  onRefresh,
}: {
  repoPath: string;
  /** True while a swarm run kicked off anywhere (Run audit, Fix, …) is in flight. */
  running: boolean;
  /** Bumped by App after a run completes, so we reload the persisted model. */
  version: number;
  /** Why the latest swarm run failed, if it did. */
  runError?: string | null;
  /** Ask App to (re)run the swarm for this repo. */
  onRefresh: () => void;
}) {
  const [model, setModel] = useState<RepositoryModel | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FloorPlanProgress | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Big repos are unreadable all at once; default to the systems-only overview.
  const [detailed, setDetailed] = useState(false);
  const cyRef = useRef<Core | null>(null);

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

  const elements = useMemo(
    () => (model ? toElements(model, detailed) : []),
    [model, detailed],
  );

  const selected = useMemo(
    () => model?.nodes.find((n) => n.id === selectedId) ?? null,
    [model, selectedId],
  );

  const kinds = useMemo(() => {
    if (!model) return [] as FloorPlanNode["kind"][];
    const present = new Set(
      (detailed
        ? model.nodes
        : model.nodes.filter((n) => n.kind === "system")
      ).map((n) => n.kind),
    );
    return (Object.keys(KIND_COLOR) as FloorPlanNode["kind"][]).filter((k) =>
      present.has(k),
    );
  }, [model, detailed]);

  const zoomBy = (factor: number): void => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };

  return (
    <div className="space-y-3">
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
        <div className="flex items-center gap-2">
          {model && (
            <Button
              variant="secondary"
              onClick={() => setDetailed((d) => !d)}
              aria-pressed={detailed}
            >
              {detailed ? "Systems only" : "Show details"}
            </Button>
          )}
          <Button onClick={onRefresh} disabled={running || !available}>
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Mapping…" : "Refresh floor plan"}
          </Button>
        </div>
      </div>

      {!available && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Deep audit needs the Claude Code CLI. Sign in with{" "}
          <code>claude login</code> so the swarm can run on your subscription.
          The deterministic scorecard still works without it.
        </p>
      )}
      {(error ?? runError) && (
        <p className="text-sm text-rose-400" role="alert">
          {error ?? runError}
        </p>
      )}
      {running && progress && (
        <p className="text-sm text-sky-300" aria-live="polite">
          {progress.message}
          {progress.total > 0 ? ` (${progress.done}/${progress.total})` : ""}
        </p>
      )}

      {model ? (
        <>
          {kinds.length > 0 && <Legend kinds={kinds} />}
          <div className="relative">
            <Graph
              key={detailed ? "detailed" : "systems"}
              elements={elements}
              onSelect={setSelectedId}
              onReady={(cy) => (cyRef.current = cy)}
            />

            {/* Zoom / fit controls, overlaid so they don't steal canvas width. */}
            <div className="absolute bottom-3 left-3 flex gap-1">
              <Button
                size="icon"
                variant="secondary"
                aria-label="Zoom in"
                onClick={() => zoomBy(1.3)}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Zoom out"
                onClick={() => zoomBy(1 / 1.3)}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Fit to view"
                onClick={() => cyRef.current?.fit(undefined, 40)}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Node details, overlaid top-right so the graph keeps full width. */}
            {selected && (
              <Card className="absolute right-3 top-3 w-64 space-y-2 p-4 shadow-lg">
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
        </>
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
