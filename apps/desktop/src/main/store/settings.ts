// Personal settings (theme, default org, AI transport preference, update prefs).
// Lives in `app.getPath('userData')`, never the repo, per the plan's state split.
// The Anthropic API key is NOT kept here — see auth/anthropic-key-store.ts.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { app } from "electron";

import { Settings, type SettingsSaveRequest } from "../../shared/ipc";

/** The defaults a fresh install starts from (and the fallback for a bad file). */
const DEFAULTS: Settings = {
  theme: "dark",
  defaultOrg: "",
  aiPreferApiKey: false,
  autoCheckUpdates: true,
};

function storePath(): string {
  return join(app.getPath("userData"), "settings.json");
}

/** Merge a partial over a base, ignoring undefined fields (keeps every key set). */
function merge(base: Settings, patch: SettingsSaveRequest): Settings {
  return {
    theme: patch.theme ?? base.theme,
    defaultOrg: patch.defaultOrg ?? base.defaultOrg,
    aiPreferApiKey: patch.aiPreferApiKey ?? base.aiPreferApiKey,
    autoCheckUpdates: patch.autoCheckUpdates ?? base.autoCheckUpdates,
  };
}

// Serialize read-modify-write so two concurrent saves can't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(storePath(), "utf8");
    // Merge over defaults so a partial/older file still yields every field, and a
    // malformed one falls back cleanly rather than throwing.
    const parsed = Settings.partial().safeParse(JSON.parse(raw));
    return parsed.success ? merge(DEFAULTS, parsed.data) : { ...DEFAULTS };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { ...DEFAULTS };
    throw err;
  }
}

/** Apply a partial update and persist; returns the full, saved settings. */
export function saveSettings(patch: SettingsSaveRequest): Promise<Settings> {
  return withLock(async () => {
    const current = await loadSettings();
    const next = merge(current, patch);
    const file = storePath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(next, null, 2), "utf8");
    return next;
  });
}
