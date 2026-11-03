// The Build tab: the orchestration layer's UI. You describe a feature or fix → the
// factory drafts a plan (read-only, floor-plan-grounded) → you approve → write-agents
// implement it in an isolated git worktree, self-check against the repo's tests/lint/
// typecheck + the factory gate, and open a gated PR. Two human checkpoints: approve
// the plan, review the PR. Your working tree is never touched.
import { GitPullRequest, Hammer, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type {
  BuildPlanView,
  BuildProgress,
  BuildResult,
} from "../../shared/ipc";

type Plan = BuildPlanView["plan"];

export function Build({ repoPath }: { repoPath: string }) {
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [buildAvailable, setBuildAvailable] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.factory.build.onProgress(setProgress), []);

  async function handlePlan(): Promise<void> {
    setPlanning(true);
    setError(null);
    setResult(null);
    setPlan(null);
    try {
      const view = await window.factory.build.plan(
        repoPath,
        description.trim(),
      );
      setBuildAvailable(view.buildAvailable);
      setPlan(view.plan);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPlanning(false);
    }
  }

  async function handleBuild(): Promise<void> {
    if (!plan) return;
    setBuilding(true);
    setError(null);
    setProgress(null);
    try {
      setResult(await window.factory.build.run(repoPath, plan));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBuilding(false);
    }
  }

  function reset(): void {
    setPlan(null);
    setResult(null);
    setProgress(null);
    setError(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Build</h2>
        <p className="text-xs text-muted-foreground">
          Describe a change; the factory plans it, builds it in an isolated
          worktree, self-checks against your gates, and opens a PR. Your working
          tree is never touched.
        </p>
      </div>

      {!buildAvailable && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Building needs the Claude Code CLI. Sign in with{" "}
          <code>claude login</code> so the agents can run on your subscription.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}

      {/* Step 1 — describe */}
      {!plan && !result && (
        <Card className="space-y-3 p-4">
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. Add CSV export to the reports API, with a test."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={planning}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => void handlePlan()}
              disabled={planning || description.trim().length === 0}
            >
              {planning ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {planning ? "Planning…" : "Plan"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2 — review the plan, then approve */}
      {plan && !result && (
        <Card className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Proposed plan</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {plan.summary}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              aria-label="Discard plan"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {plan.affectedSystems.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {plan.affectedSystems.map((s) => (
                <span
                  key={s}
                  className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {plan.tasks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Tasks</p>
              <ol className="space-y-1.5">
                {plan.tasks.map((t, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">
                      {i + 1}. {t.title}
                    </span>
                    {t.detail && (
                      <span className="block text-xs text-muted-foreground">
                        {t.detail}
                      </span>
                    )}
                    {t.paths.length > 0 && (
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {t.paths.join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {plan.acceptanceCriteria.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Acceptance criteria
              </p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {plan.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.risks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-400">Risks</p>
              <ul className="list-inside list-disc text-xs text-amber-300/80">
                {plan.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {building && progress && (
            <p className="text-sm text-sky-300" aria-live="polite">
              {progress.message}
              {progress.total > 0
                ? ` (${progress.done}/${progress.total})`
                : ""}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset} disabled={building}>
              Discard
            </Button>
            <Button
              onClick={() => void handleBuild()}
              disabled={building || !buildAvailable}
            >
              {building ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Hammer className="h-4 w-4" />
              )}
              {building ? "Building…" : "Approve & build"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3 — result */}
      {result && (
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {result.verify.passed ? "Build passed" : "Build did not pass"}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                · {result.iterations} iteration
                {result.iterations === 1 ? "" : "s"}
              </span>
            </h3>
            <Button size="sm" variant="secondary" onClick={reset}>
              Start another
            </Button>
          </div>

          <div className="space-y-1">
            {result.verify.checks.map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-sm">
                <span>{c.ran ? (c.passed ? "✅" : "❌") : "⚪️"}</span>
                <span className={c.ran ? "" : "text-muted-foreground"}>
                  {c.name}
                  {!c.ran && " (skipped)"}
                </span>
              </div>
            ))}
          </div>

          {result.pr ? (
            <p className="flex items-center gap-1.5 text-sm text-sky-400">
              <GitPullRequest className="h-4 w-4" />
              {result.pr.reused ? "Updated" : "Opened"} PR #{result.pr.number}:{" "}
              {result.pr.url}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {result.verify.passed
                ? `Committed to branch ${result.branch} (not pushed).`
                : `Checks did not pass — no PR opened. The attempt is on branch ${result.branch} for inspection.`}
            </p>
          )}

          {result.notes && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Agent notes</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono">
                {result.notes}
              </pre>
            </details>
          )}
        </Card>
      )}
    </div>
  );
}
