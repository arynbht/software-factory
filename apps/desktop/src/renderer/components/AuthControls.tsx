import { LogIn, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

import type { DeviceCodeInfo } from "../../shared/ipc";

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "pending"; code: DeviceCodeInfo }
  | { kind: "signed-in"; login: string | null };

export function AuthControls() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.factory.auth.status().then(
      (status) =>
        setState(
          status.signedIn
            ? { kind: "signed-in", login: status.login }
            : { kind: "signed-out" },
        ),
      () => setState({ kind: "signed-out" }),
    );

    // Background sign-in outcome (after the user authorizes in the browser).
    const unsubscribe = window.factory.auth.onUpdate((update) => {
      if (update.status === "signed-in") {
        setError(null);
        setState({ kind: "signed-in", login: update.login || null });
      } else {
        setError(update.message);
        setState({ kind: "signed-out" });
      }
    });
    return unsubscribe;
  }, []);

  async function handleSignIn(): Promise<void> {
    setError(null);
    try {
      const code = await window.factory.auth.signIn();
      setState({ kind: "pending", code });
    } catch (err) {
      setError(errorMessage(err));
      setState({ kind: "signed-out" });
    }
  }

  async function handleSignOut(): Promise<void> {
    await window.factory.auth.signOut();
    setState({ kind: "signed-out" });
  }

  return (
    <div className="border-t border-border p-3 text-xs">
      {state.kind === "loading" && (
        <span className="text-muted-foreground">Checking sign-in…</span>
      )}

      {state.kind === "signed-out" && (
        <div className="space-y-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => void handleSignIn()}
          >
            <LogIn className="h-4 w-4" />
            Sign in with GitHub
          </Button>
          {error && (
            <p className="text-rose-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {state.kind === "pending" && (
        <div className="space-y-1">
          <p className="text-muted-foreground">
            Enter this code at{" "}
            <span className="text-foreground">github.com/login/device</span>:
          </p>
          <p className="font-mono text-base tracking-widest text-sky-400">
            {state.code.userCode}
          </p>
          <p className="text-muted-foreground">
            Waiting for authorization in your browser…
          </p>
        </div>
      )}

      {state.kind === "signed-in" && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground">
            {state.login ? `@${state.login}` : "Signed in"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleSignOut()}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
