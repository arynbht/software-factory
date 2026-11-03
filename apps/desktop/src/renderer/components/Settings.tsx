import { Check, Download, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { applyTheme } from "@/lib/theme";

import type { SettingsView, Theme, UpdateInfo } from "../../shared/ipc";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field(props: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={props.htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {props.label}
      </label>
      {props.children}
      {props.hint && (
        <p className="text-xs text-muted-foreground/80">{props.hint}</p>
      )}
    </div>
  );
}

function CheckboxRow(props: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={props.id}
      className="flex cursor-pointer items-start justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-accent/40"
    >
      <span>
        <span className="text-sm">{props.label}</span>
        {props.hint && (
          <span className="block text-xs text-muted-foreground">
            {props.hint}
          </span>
        )}
      </span>
      <input
        id={props.id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

export function Settings({
  onThemeChange,
}: {
  onThemeChange: (theme: Theme) => void;
}) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [org, setOrg] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.factory.settings.load().then(
      (v) => {
        if (!active) return;
        setView(v);
        setOrg(v.defaultOrg);
      },
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, []);

  async function patch(
    changes: Parameters<typeof window.factory.settings.save>[0],
  ): Promise<void> {
    setError(null);
    try {
      setView(await window.factory.settings.save(changes));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function handleThemeChange(theme: Theme): void {
    applyTheme(theme); // live preview
    onThemeChange(theme); // keep App's system-change listener in sync
    void patch({ theme });
  }

  async function handleSaveKey(): Promise<void> {
    setSavingKey(true);
    setError(null);
    try {
      setView(await window.factory.settings.setAnthropicKey(keyInput));
      setKeyInput("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleClearKey(): Promise<void> {
    setSavingKey(true);
    setError(null);
    try {
      setView(await window.factory.settings.setAnthropicKey(""));
      setKeyInput("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleCheckUpdate(): Promise<void> {
    setChecking(true);
    setUpdateError(null);
    setUpdate(null);
    try {
      setUpdate(await window.factory.update.check());
    } catch (err) {
      setUpdateError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  if (error && !view) {
    return (
      <p className="text-sm text-rose-400" role="alert">
        {error}
      </p>
    );
  }
  if (!view) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <h2 className="text-xl font-semibold">Settings</h2>

      {error && (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}

      <Card className="space-y-4 p-4">
        <h3 className="text-sm font-semibold">General</h3>
        <Field label="Theme" htmlFor="setting-theme">
          <select
            id="setting-theme"
            className={inputClass}
            value={view.theme}
            onChange={(e) => handleThemeChange(e.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <Field
          label="Default GitHub org"
          htmlFor="setting-org"
          hint="Prefilled where an owner is needed."
        >
          <input
            id="setting-org"
            className={inputClass}
            value={org}
            placeholder="my-org"
            onChange={(e) => setOrg(e.target.value)}
            onBlur={() => {
              if (org !== view.defaultOrg) void patch({ defaultOrg: org });
            }}
          />
        </Field>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">AI</h3>
        <CheckboxRow
          id="setting-prefer-api"
          label="Prefer the Anthropic API over the Claude CLI"
          hint="Off uses your Claude Code subscription when available (recommended)."
          checked={view.aiPreferApiKey}
          onChange={(next) => void patch({ aiPreferApiKey: next })}
        />
        <Field
          label="Anthropic API key"
          htmlFor="setting-anthropic-key"
          hint={
            view.anthropicKeySet
              ? "A key is stored (encrypted). Enter a new one to replace it."
              : "Optional fallback for when the Claude CLI isn't available."
          }
        >
          <div className="flex gap-2">
            <input
              id="setting-anthropic-key"
              type="password"
              autoComplete="off"
              className={inputClass}
              value={keyInput}
              placeholder={view.anthropicKeySet ? "••••••••" : "sk-ant-…"}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={savingKey || keyInput.trim() === ""}
              onClick={() => void handleSaveKey()}
            >
              <KeyRound className="h-4 w-4" />
              Save
            </Button>
            {view.anthropicKeySet && (
              <Button
                variant="ghost"
                disabled={savingKey}
                onClick={() => void handleClearKey()}
                aria-label="Clear stored Anthropic key"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Field>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Updates</h3>
        <CheckboxRow
          id="setting-auto-update"
          label="Check for updates on launch"
          checked={view.autoCheckUpdates}
          onChange={(next) => void patch({ autoCheckUpdates: next })}
        />
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={checking}
            onClick={() => void handleCheckUpdate()}
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Check for updates
          </Button>
          {update && !update.updateAvailable && (
            <span className="flex items-center gap-1 text-sm text-emerald-400">
              <Check className="h-4 w-4" />
              Up to date (v{update.currentVersion.replace(/^v/, "")})
            </span>
          )}
        </div>
        {update?.updateAvailable && (
          <p className="text-sm text-sky-400">
            Update available: {update.latestVersion} (you have v
            {update.currentVersion.replace(/^v/, "")}).{" "}
            {update.url && (
              <a
                href={update.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Download
              </a>
            )}
          </p>
        )}
        {update && !update.updateAvailable && update.latestVersion === null && (
          <p className="text-sm text-muted-foreground">
            No published release found.
          </p>
        )}
        {updateError && (
          <p className="text-sm text-rose-400" role="alert">
            {updateError}
          </p>
        )}
      </Card>
    </div>
  );
}
