import { FolderPlus, Play, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Scorecard } from "@/components/Scorecard";
import { Button } from "@/components/ui/button";

import type { RepoEntry, Scorecard as ScorecardData } from "../shared/ipc";

export function App() {
  // The preload exposes `window.factory`; if it failed to load, surface a clear
  // message instead of letting every handler throw into a blank screen.
  const bridgeReady = typeof window.factory !== "undefined";
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridgeReady) return;
    window.factory.repos.list().then(setRepos, (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [bridgeReady]);

  async function handleAdd(): Promise<void> {
    setError(null);
    try {
      setRepos(await window.factory.repos.add());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(path: string): Promise<void> {
    setRepos(await window.factory.repos.remove(path));
    if (selected === path) {
      setSelected(null);
      setScorecard(null);
    }
  }

  function handleSelect(path: string): void {
    setSelected(path);
    setScorecard(null);
    setError(null);
  }

  async function handleAudit(): Promise<void> {
    if (!selected) return;
    setRunning(true);
    setError(null);
    try {
      setScorecard(await window.factory.audit.run(selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const selectedRepo = repos.find((r) => r.path === selected) ?? null;

  if (!bridgeReady) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <p className="max-w-sm text-sm text-rose-300" role="alert">
          The application bridge failed to load (preload error). Restart the
          app.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/30">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-sm font-semibold tracking-tight">Factory</h1>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleAdd()}
          >
            <FolderPlus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {repos.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No repositories yet. Add a local folder to audit it.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {repos.map((repo) => (
                <li key={repo.path}>
                  <div
                    className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${
                      repo.path === selected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(repo.path)}
                      className="min-w-0 flex-1 text-left"
                      title={repo.path}
                    >
                      <span className="block truncate text-sm">
                        {repo.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {repo.path}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(repo.path)}
                      aria-label={`Remove ${repo.name}`}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {selectedRepo ? (
          <div className="mx-auto max-w-4xl space-y-5 p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold">
                  {selectedRepo.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {selectedRepo.path}
                </p>
              </div>
              <Button onClick={() => void handleAudit()} disabled={running}>
                {running ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {running ? "Auditing…" : "Run audit"}
              </Button>
            </div>

            {error && (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-rose-300"
                role="alert"
              >
                {error}
              </p>
            )}

            {scorecard ? (
              <Scorecard data={scorecard} />
            ) : (
              !running && (
                <p className="text-sm text-muted-foreground">
                  Run an audit to see the lane scorecard.
                </p>
              )
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              Select a repository on the left, or add a local folder to get
              started.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
