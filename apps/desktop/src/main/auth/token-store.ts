// The GitHub token lives here — encrypted at rest with Electron safeStorage (the
// OS keychain / credential store), in userData, never in the repo and never
// across IPC. The renderer asks main to act; only main ever holds the token.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";

// Headless CI has no OS keyring, so safeStorage can be unavailable there. In E2E
// (and only E2E) persist the token as plaintext in the throwaway userData dir so the
// sign-in flow still runs end to end. Never set in a real session — real tokens are
// always encrypted at rest. Mirrors the other FACTORY_E2E seams in the main process.
const isE2E = process.env.FACTORY_E2E === "1";

function tokenPath(): string {
  return join(app.getPath("userData"), "github-token.bin");
}

export async function saveToken(token: string): Promise<void> {
  const file = tokenPath();
  await mkdir(dirname(file), { recursive: true });
  if (isE2E) {
    await writeFile(file, token, "utf8");
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("secure storage is unavailable on this system");
  }
  await writeFile(file, safeStorage.encryptString(token));
}

export async function loadToken(): Promise<string | null> {
  try {
    if (isE2E) return await readFile(tokenPath(), "utf8");
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
