import {
  FolderPlus,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Ai } from "@/components/Ai";
import { AuthControls } from "@/components/AuthControls";
import { Docs } from "@/components/Docs";
import { Fix } from "@/components/Fix";
import { Gates } from "@/components/Gates";
import { ProfileForm } from "@/components/ProfileForm";
import { Scorecard } from "@/components/Scorecard";
import { Settings } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { applyTheme } from "@/lib/theme";

type View = "scorecard" | "profile" | "gates" | "fix" | "ai" | "docs";

const TABS: { id: View; label: string }[] = [
  { id: "scorecard", label: "Scorecard" },
  { id: "profile", label: "Profile" },
  { id: "gates", label: "Gates" },
  { id: "fix", label: "Fix" },
  { id: "ai", label: "AI" },
  { id: "docs", label: "Docs" },
];

import type {
  RepoEntry,
  Scorecard as ScorecardData,
  Theme,
  UpdateInfo,
} from "../shared/ipc";

/** The screen tab bar as an ARIA tablist: roving tabindex + arrow-key nav. */
function TabBar({
  view,
  onSelect,
}: {
  view: View;
  onSelect: (v: View) => void;
}) {
  const refs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  function onKeyDown(e: React.KeyboardEvent): void {
    const i = TABS.findIndex((t) => t.id === view);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const target = TABS[next];
    if (!target) return;
    onSelect(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Repository views"
      onKeyDown={onKeyDown}
      className="flex gap-4 border-b border-border text-sm"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={view === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={view === t.id ? 0 : -1}
          onClick={() => onSelect(t.id)}
          className={`-mb-px rounded-t-sm border-b-2 px-1 pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            view === t.id
              ? "border-sky-500 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  // The preload exposes `window.factory`; if it failed to load, surface a clear
  // message instead of letting every handler throw into a blank screen.
  const bridgeReady = typeof window.factory !== "undefined";
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("scorecard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The applied theme setting; drives the OS-preference listener below.
  const [theme, setTheme] = useState<Theme>("dark");
  // Set by the opt-in launch update check when a newer release is available.
  const [updateBanner, setUpdateBanner] = useState<UpdateInfo | null>(null);
  // Views the user has opened for the current repo. A view stays mounted once
  // opened (just hidden), so switching tabs doesn't reset its state (unsaved
  // profile edits, expanded gates, the scorecard). Reset when the repo changes.
  const [opened, setOpened] = useState<Set<View>>(
    () => new Set<View>(["scorecard"]),
  );

  function showView(next: View): void {
    setView(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }

  useEffect(() => {
    if (!bridgeReady) return;
    window.factory.repos.list().then(setRepos, (err: unknown) => {
      setError(errorMessage(err));
    });
    // Apply the saved theme as early as possible (index.html defaults to dark).
    window.factory.settings.load().then(
      (s) => {
        setTheme(s.theme);
        applyTheme(s.theme);
        // Opt-in launch update check; show a banner only if one is available.
        if (s.autoCheckUpdates) {
          window.factory.update.check().then(
            (info) => info.updateAvailable && setUpdateBanner(info),
            () => {
              // A failed launch check is silent; the user can retry in Settings.
            },
          );
        }
      },
      () => {
        // Settings unreadable — keep the default dark theme.
      },
    );
  }, [bridgeReady]);

  // Re-apply "system" theme when the OS preference changes while the app is open.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  async function handleAdd(): Promise<void> {
    setError(null);
    try {
      setRepos(await window.factory.repos.add());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleRemove(path: string): Promise<void> {
    setError(null);
    try {
      setRepos(await window.factory.repos.remove(path));
      if (selected === path) {
        setSelected(null);
        setScorecard(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function handleSelect(path: string): void {
    setSettingsOpen(false);
    setSelected(path);
    setScorecard(null);
    setError(null);
    setView("scorecard");
    setOpened(new Set<View>(["scorecard"])); // fresh state for the new repo
  }

  async function handleAudit(): Promise<void> {
    if (!selected) return;
    setRunning(true);
    setError(null);
    try {
      setScorecard(await window.factory.audit.run(selected));
    } catch (err) {
      setError(errorMessage(err));
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
                      aria-current={repo.path === selected ? "true" : undefined}
                      className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="px-2 pb-2">
          <Button
            size="sm"
            variant={settingsOpen ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => setSettingsOpen(true)}
            aria-current={settingsOpen ? "page" : undefined}
          >
            <SettingsIcon className="h-4 w-4" />
            Settings
          </Button>
        </div>
        <AuthControls />
      </aside>

      <main className="flex-1 overflow-y-auto">
        {updateBanner && (
          <div className="flex items-center justify-between gap-3 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300">
            <span>
              Update available: {updateBanner.latestVersion}.{" "}
              {updateBanner.url && (
                <a
                  href={updateBanner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Download
                </a>
              )}
            </span>
            <button
              type="button"
              onClick={() => setUpdateBanner(null)}
              aria-label="Dismiss update notice"
              className="shrink-0 rounded p-1 hover:bg-background/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {settingsOpen ? (
          <Settings onThemeChange={setTheme} />
        ) : selectedRepo ? (
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
              {view === "scorecard" && (
                <Button onClick={() => void handleAudit()} disabled={running}>
                  {running ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {running ? "Auditing…" : "Run audit"}
                </Button>
              )}
            </div>

            <TabBar view={view} onSelect={showView} />

            {/* Each panel stays mounted once opened (hidden when inactive), so
                switching tabs preserves its state; `opened` resets per repo. */}
            <div
              id="panel-scorecard"
              role="tabpanel"
              aria-labelledby="tab-scorecard"
              tabIndex={0}
              hidden={view !== "scorecard"}
            >
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

            {opened.has("profile") && (
              <div
                id="panel-profile"
                role="tabpanel"
                aria-labelledby="tab-profile"
                tabIndex={0}
                hidden={view !== "profile"}
              >
                <ProfileForm
                  repoPath={selectedRepo.path}
                  repoName={selectedRepo.name}
                />
              </div>
            )}

            {opened.has("gates") && (
              <div
                id="panel-gates"
                role="tabpanel"
                aria-labelledby="tab-gates"
                tabIndex={0}
                hidden={view !== "gates"}
              >
                <Gates repoPath={selectedRepo.path} />
              </div>
            )}

            {opened.has("fix") && (
              <div
                id="panel-fix"
                role="tabpanel"
                aria-labelledby="tab-fix"
                tabIndex={0}
                hidden={view !== "fix"}
              >
                {/* key resets the panel's run/PR state when the repo changes. */}
                <Fix key={selectedRepo.path} repoPath={selectedRepo.path} />
              </div>
            )}

            {opened.has("ai") && (
              <div
                id="panel-ai"
                role="tabpanel"
                aria-labelledby="tab-ai"
                tabIndex={0}
                hidden={view !== "ai"}
              >
                {/* key resets the panel's draft/run state when the repo changes. */}
                <Ai key={selectedRepo.path} repoPath={selectedRepo.path} />
              </div>
            )}

            {opened.has("docs") && (
              <div
                id="panel-docs"
                role="tabpanel"
                aria-labelledby="tab-docs"
                tabIndex={0}
                hidden={view !== "docs"}
              >
                <Docs repoPath={selectedRepo.path} />
              </div>
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
