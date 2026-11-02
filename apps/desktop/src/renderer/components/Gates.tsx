import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type {
  GateBlocker,
  GatePhase,
  GatesReport,
  GateStatus,
} from "../../shared/ipc";

const GATE_DOT: Record<GateStatus, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function in90Days(): string {
  return new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
}

function BlockerRow({
  blocker,
  onWaive,
  onEvidence,
}: {
  blocker: GateBlocker;
  onWaive: (reason: string, expires: string) => Promise<void>;
  onEvidence: (url: string, note: string) => Promise<void>;
}) {
  const [form, setForm] = useState<"waive" | "evidence" | null>(null);
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState(in90Days());
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      setForm(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-border/60 px-4 py-2.5">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            blocker.status === "fail" ? "bg-rose-500" : "bg-amber-500"
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{blocker.title}</p>
          <p className="text-xs text-muted-foreground">
            {blocker.controlId} · {blocker.severity} · {blocker.status}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm(form === "waive" ? null : "waive")}
          >
            Waive
          </Button>
          {blocker.status === "needs-evidence" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setForm(form === "evidence" ? null : "evidence")}
            >
              Evidence
            </Button>
          )}
        </div>
      </div>

      {form === "waive" && (
        <div className="mt-2 space-y-2 rounded-md bg-background/50 p-2">
          <input
            className={inputClass}
            placeholder="Reason for the waiver"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Expires</label>
            <input
              type="date"
              className={inputClass}
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => void submit(() => onWaive(reason, expires))}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {form === "evidence" && (
        <div className="mt-2 space-y-2 rounded-md bg-background/50 p-2">
          <input
            className={inputClass}
            placeholder="Evidence URL (e.g. a doc or PR link)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !url.trim()}
              onClick={() => void submit(() => onEvidence(url, note))}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function PhaseCard({
  phase,
  onWaive,
  onEvidence,
}: {
  phase: GatePhase;
  onWaive: (control: string, reason: string, expires: string) => Promise<void>;
  onEvidence: (control: string, url: string, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(phase.inferred);
  const dot = phase.status ? GATE_DOT[phase.status] : "bg-slate-600";
  const hasBlockers = phase.blockers.length > 0;

  return (
    <Card className={phase.inferred ? "ring-1 ring-sky-500/60" : ""}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left"
        disabled={!hasBlockers}
      >
        {hasBlockers ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4" />
        )}
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
          aria-hidden
        />
        <span className="flex-1 font-medium capitalize">{phase.title}</span>
        {phase.inferred && (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">
            inferred phase
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {phase.status ?? "n/a"}
          {hasBlockers ? ` · ${phase.blockers.length} blocking` : ""}
        </span>
      </button>
      {open && hasBlockers && (
        <ul>
          {phase.blockers.map((b) => (
            <BlockerRow
              key={b.controlId}
              blocker={b}
              onWaive={(reason, expires) =>
                onWaive(b.controlId, reason, expires)
              }
              onEvidence={(url, note) => onEvidence(b.controlId, url, note)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Gates({ repoPath }: { repoPath: string }) {
  const [report, setReport] = useState<GatesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    window.factory.gates.status(repoPath).then(
      (r) => active && setReport(r),
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, [repoPath]);

  async function handleWaive(
    control: string,
    reason: string,
    expires: string,
  ): Promise<void> {
    setReport(
      await window.factory.gates.waive({ repoPath, control, reason, expires }),
    );
  }

  async function handleEvidence(
    control: string,
    url: string,
    note: string,
  ): Promise<void> {
    setReport(
      await window.factory.gates.attachEvidence({
        repoPath,
        control,
        url,
        note,
        validFor: "365d",
      }),
    );
  }

  if (error) {
    return (
      <p className="text-sm text-rose-400" role="alert">
        {error}
      </p>
    );
  }
  if (!report) {
    return <p className="text-sm text-muted-foreground">Evaluating gates…</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Gates</h2>
        <p className="text-xs text-muted-foreground">
          Inferred phase:{" "}
          <span className="capitalize text-foreground">
            {report.inferredPhase ?? "—"}
          </span>
        </p>
      </div>
      {report.phases.map((phase) => (
        <PhaseCard
          key={phase.phase}
          phase={phase}
          onWaive={handleWaive}
          onEvidence={handleEvidence}
        />
      ))}
    </div>
  );
}
