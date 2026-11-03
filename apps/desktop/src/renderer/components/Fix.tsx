import { ChevronDown, ChevronRight, GitPullRequest, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type { FixChange, FixPlan, FixPrOutcome } from "../../shared/ipc";

const ACTION: Record<FixChange["action"], string> = {
  create: "text-emerald-400",
  update: "text-sky-400",
  suggest: "text-amber-400",
  skip: "text-slate-400",
  unchanged: "text-slate-400",
  effect: "text-violet-400",
};

const preClass =
  "max-h-64 overflow-auto rounded bg-background/70 p-2 text-xs font-mono whitespace-pre-wrap break-words";

function ChangeRow({ change }: { change: FixChange }) {
  const [open, setOpen] = useState(false);
  const canExpand =
    change.after !== undefined || change.before !== undefined || !!change.error;

  return (
    <li className="border-t border-border/60">
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/40"
        aria-expanded={open}
      >
        {canExpand ? (
          open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4" />
        )}
        <span className="min-w-0 flex-1">
          <span className="text-sm">{change.path ?? change.controlId}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {change.message}
          </span>
        </span>
        <span className={`shrink-0 text-xs ${ACTION[change.action]}`}>
          {change.action}
        </span>
      </button>

      {open && canExpand && (
        <div className="space-y-2 px-9 pb-3">
          {change.error && (
            <p className="text-xs text-rose-400">{change.error}</p>
          )}
          {change.before !== undefined && change.action !== "create" && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Before</p>
              <pre className={preClass}>{change.before}</pre>
            </div>
          )}
          {change.after !== undefined && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">After</p>
              <pre className={preClass}>{change.after}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function Fix({
  repoPath,
  onChanged,
}: {
  repoPath: string;
  /** Called after changes land locally or via PR, so the floor plan can refresh. */
  onChanged?: () => void;
}) {
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pr, setPr] = useState<FixPrOutcome | null>(null);

  useEffect(() => {
    let active = true;
    setPlan(null);
    setError(null);
    setNotice(null);
    setPr(null);
    window.factory.fix.plan(repoPath).then(
      (p) => active && setPlan(p),
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, [repoPath]);

  async function run(
    fn: () => Promise<void>,
    onError = (m: string) => setError(m),
  ): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPr(null); // drop any prior PR banner before a new apply/open-PR run
    try {
      await fn();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(): Promise<void> {
    await run(async () => {
      const result = await window.factory.fix.apply(repoPath);
      setPlan(result);
      const applied = result.changes.filter(
        (c) => c.action === "create" || c.action === "update",
      ).length;
      setNotice(
        `Applied ${applied} change${applied === 1 ? "" : "s"} locally.`,
      );
      if (applied > 0) onChanged?.();
    });
  }

  async function handleOpenPr(): Promise<void> {
    await run(async () => {
      const outcome = await window.factory.fix.openPr(repoPath);
      setPr(outcome);
      if (!outcome.pr) setNotice("No changes to propose — no PR opened.");
    });
  }

  const changes = plan?.changes ?? [];
  const actionable = changes.filter(
    (c) =>
      c.action === "create" || c.action === "update" || c.action === "suggest",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fix</h2>
          <p className="text-xs text-muted-foreground">
            {plan
              ? `${actionable.length} change${actionable.length === 1 ? "" : "s"} to apply`
              : "Planning…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={busy || actionable.length === 0}
            onClick={() => void handleApply()}
          >
            <Save className="h-4 w-4" />
            Apply locally
          </Button>
          <Button
            disabled={busy || actionable.length === 0}
            onClick={() => void handleOpenPr()}
          >
            <GitPullRequest className="h-4 w-4" />
            Open PR
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-emerald-400" aria-live="polite">
          {notice}
        </p>
      )}
      {pr?.pr && (
        <p className="text-sm text-sky-400" aria-live="polite">
          {pr.pr.reused ? "Updated" : "Opened"} PR #{pr.pr.number} ({pr.commits}{" "}
          commit{pr.commits === 1 ? "" : "s"}): {pr.pr.url}
        </p>
      )}

      {plan && plan.generatorErrors.length > 0 && (
        <Card className="border-rose-500/40 p-3 text-xs text-rose-300">
          <p className="font-medium">Generator errors</p>
          {plan.generatorErrors.map((e) => (
            <p key={e.controlId}>
              {e.controlId} ({e.fixType}): {e.message}
            </p>
          ))}
        </Card>
      )}

      {plan && changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to fix — all fixable controls already pass.
        </p>
      ) : (
        <Card>
          <ul>
            {changes.map((change, i) => (
              <ChangeRow
                key={`${change.controlId}:${change.path ?? i}`}
                change={change}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
