// The Anthropic API key (AI fallback when the Claude CLI isn't used) is stored
// here, encrypted at rest with Electron safeStorage, in userData — never in the
// repo and never across IPC. The renderer only learns whether a key is set; only
// main ever reads the value, to hand it to the engine's AI client.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";

function keyPath(): string {
  return join(app.getPath("userData"), "anthropic-key.bin");
}

export async function saveAnthropicKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("secure storage is unavailable on this system");
  }
  const file = keyPath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, safeStorage.encryptString(key));
}

export async function loadAnthropicKey(): Promise<string | null> {
  try {
    const encrypted = await readFile(keyPath());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(encrypted);
  } catch {
    // Missing, corrupt, or undecryptable (e.g. a different machine) → no key.
    return null;
  }
}

export async function clearAnthropicKey(): Promise<void> {
  await rm(keyPath(), { force: true });
}

/** Whether a key is stored, without decrypting or exposing its value. */
export async function hasAnthropicKey(): Promise<boolean> {
  return (await loadAnthropicKey()) !== null;
}
