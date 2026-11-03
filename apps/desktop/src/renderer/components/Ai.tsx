import { GitPullRequest, Play, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type { AiRunResult, AiTaskInfo, FixPrOutcome } from "../../shared/ipc";

const selectClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Ai({
  repoPath,
  onChanged,
}: {
  repoPath: string;
  /** Called after a draft is applied locally, so the floor plan can refresh. */
  onChanged?: () => void;
}) {
  const [tasks, setTasks] = useState<AiTaskInfo[] | null>(null);
  const [task, setTask] = useState("");
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pr, setPr] = useState<FixPrOutcome | null>(null);

  useEffect(() => {
    window.factory.ai.tasks().then(
      (list) => {
        setTasks(list);
        setTask((t) => t || list[0]?.task || "");
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, []);

  async function handleRun(): Promise<void> {
    if (!task) return;
    setRunning(true);
    setError(null);
    setNotice(null);
    setPr(null);
    setResult(null);
    try {
      setResult(await window.factory.ai.run(repoPath, task));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  async function withBusy(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(): Promise<void> {
    if (!result) return;
    await withBusy(async () => {
      const applied = await window.factory.ai.apply({
        repoPath,
        task: result.task,
        outputPath: result.outputPath,
        contents: result.contents,
      });
      setNotice(`${applied.action} ${applied.path}`);
      onChanged?.();
    });
  }

  async function handleOpenPr(): Promise<void> {
    if (!result) return;
    await withBusy(async () => {
      setPr(
        await window.factory.ai.openPr({
          repoPath,
          task: result.task,
          outputPath: result.outputPath,
          contents: result.contents,
        }),
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI</h2>
          <p className="text-xs text-muted-foreground">
            Claude-drafted artifacts, on your Claude subscription.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className={selectClass}
            aria-label="AI task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            disabled={!tasks || running}
          >
            {(tasks ?? []).map((t) => (
              <option key={t.task} value={t.task}>
                {t.task}
              </option>
            ))}
          </select>
          <Button onClick={() => void handleRun()} disabled={running || !task}>
            {running ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {running ? "Drafting…" : "Run"}
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
          {pr.pr.reused ? "Updated" : "Opened"} PR #{pr.pr.number}: {pr.pr.url}
        </p>
      )}

      {result && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              → <span className="text-foreground">{result.outputPath}</span>
            </span>
            <span>{result.model}</span>
            <span>
              {result.inputTokens} in / {result.outputTokens} out tokens
            </span>
            <span>~${result.costUsd.toFixed(4)}</span>
            <span>
              files consulted:{" "}
              {result.includedFiles.length > 0
                ? result.includedFiles.join(", ")
                : "none"}
              {result.truncated ? " (context truncated)" : ""}
            </span>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-3 text-xs font-mono">
            {result.contents}
          </pre>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void handleApply()}
            >
              <Save className="h-4 w-4" />
              Apply locally
            </Button>
            <Button disabled={busy} onClick={() => void handleOpenPr()}>
              <GitPullRequest className="h-4 w-4" />
              Open PR
            </Button>
          </div>
        </Card>
      )}

      {!result && !running && (
        <p className="text-sm text-muted-foreground">
          Pick a task and Run to draft it. The draft is previewed here before
          you apply it or open a PR — review it (Claude drafts, humans sign).
        </p>
      )}
    </div>
  );
}
