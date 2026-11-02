/**
 * A clean, human-readable message from a caught value. Electron wraps an
 * `ipcRenderer.invoke` rejection as `Error invoking remote method 'x': Error:
 * <msg>`; strip that so the UI shows just the underlying message.
 */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    "",
  );
}
