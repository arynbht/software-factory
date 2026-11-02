// The GitHub token lives here — encrypted at rest with Electron safeStorage (the
// OS keychain / credential store), in userData, never in the repo and never
// across IPC. The renderer asks main to act; only main ever holds the token.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";

function tokenPath(): string {
  return join(app.getPath("userData"), "github-token.bin");
}

export async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("secure storage is unavailable on this system");
  }
  const file = tokenPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, safeStorage.encryptString(token));
}

export async function loadToken(): Promise<string | null> {
  try {
    const encrypted = await readFile(tokenPath());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(encrypted);
  } catch {
    // Missing, corrupt, or undecryptable (e.g. a different machine) → signed out.
    return null;
  }
}

export async function clearToken(): Promise<void> {
  await rm(tokenPath(), { force: true });
}
