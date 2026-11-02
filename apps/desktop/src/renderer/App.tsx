import { useState } from "react";

/**
 * M5.1 shell: a placeholder window whose only job is to prove the typed,
 * zod-validated IPC bridge works end to end. The real screens (Repos, Scorecard,
 * …) land from M5.2 onward.
 */
export function App() {
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePing(): Promise<void> {
    setError(null);
    try {
      const result = await window.factory.ping("hello from the renderer");
      setReply(`${result.reply} — main v${result.version}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Factory</h1>
        <p className="text-sm text-slate-400">
          Desktop shell — M5.1 scaffold. Sandboxed renderer, context-isolated,
          CSP-locked, typed IPC.
        </p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
        <button
          type="button"
          onClick={() => void handlePing()}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          Ping the main process
        </button>

        {reply && (
          <p className="mt-4 text-sm text-emerald-400" role="status">
            {reply}
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm text-rose-400" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
