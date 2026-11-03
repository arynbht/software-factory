import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { STATUS_META } from "@/lib/status";

import type {
  Scorecard as ScorecardData,
  ScorecardControl,
  ScorecardLane,
  StatusCounts,
} from "../../shared/ipc";

/** The non-zero count pills for a lane or the totals row. */
function CountPills({ counts }: { counts: StatusCounts }) {
  const pills: { key: string; label: string; n: number; meta: string }[] = [
    { key: "fail", label: "fail", n: counts.fail, meta: STATUS_META.fail.text },
    {
      key: "needs-evidence",
      label: "need-ev",
      n: counts.needsEvidence,
      meta: STATUS_META["needs-evidence"].text,
    },
    { key: "pass", label: "pass", n: counts.pass, meta: STATUS_META.pass.text },
    {
      key: "waived",
      label: "waived",
      n: counts.waived,
      meta: STATUS_META.waived.text,
    },
    { key: "skip", label: "skip", n: counts.skip, meta: STATUS_META.skip.text },
    { key: "n/a", label: "n/a", n: counts.na, meta: STATUS_META["n/a"].text },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
      {pills
        .filter((p) => p.n > 0)
        .map((p) => (
          <span key={p.key} className={p.meta}>
            {p.n} {p.label}
          </span>
        ))}
    </div>
  );
}

function ControlRow({ control }: { control: ScorecardControl }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[control.status];
  const hasDetail = control.rationale || control.references.length > 0;

  return (
    <li className="border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
      >
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {control.title}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {control.controlId}
            </span>
          </span>
          {control.message && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {control.message}
            </span>
          )}
        </span>
        <span className={`shrink-0 text-xs ${meta.text}`}>{meta.label}</span>
      </button>

      {open && hasDetail && (
        <div className="space-y-2 bg-background/40 px-9 pb-3 pt-1 text-xs text-muted-foreground">
          {control.rationale && <p>{control.rationale}</p>}
          {control.references.length > 0 && (
            <div>
              <p className="font-medium text-foreground/80">References</p>
              <ul className="mt-1 space-y-0.5">
                {control.references.map((ref) => (
                  <li key={ref.url}>
                    {ref.name}
                    {ref.section ? ` — ${ref.section}` : ""}
                    <span className="ml-1 break-all text-muted-foreground">
                      {ref.url}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function LaneCard({ lane }: { lane: ScorecardLane }) {
  const [open, setOpen] = useState(lane.counts.fail > 0);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 font-medium">{lane.title}</span>
        <CountPills counts={lane.counts} />
      </button>
      {open && (
        <ul>
          {lane.controls.map((control) => (
            <ControlRow key={control.controlId} control={control} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Scorecard({ data }: { data: ScorecardData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Scorecard</h2>
          <p className="text-xs text-muted-foreground">
            {data.totals.total} controls ·{" "}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <CountPills counts={data.totals} />
      </div>
      <div className="space-y-3">
        {data.lanes.map((lane) => (
          <LaneCard key={lane.key} lane={lane} />
        ))}
      </div>
    </div>
  );
}
