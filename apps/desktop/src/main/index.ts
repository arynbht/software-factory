import { readFileSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

import {
  AuditRunRequest,
  AuthStatus,
  type AuthUpdate,
  DeviceCodeInfo,
  IpcChannel,
  PingRequest,
  type PingResponse,
  RepoList,
  RepoRemoveRequest,
  Scorecard,
} from "../shared/ipc";
import {
  fetchUserLogin,
  pollForToken,
  requestDeviceCode,
} from "./auth/device-flow";
import { clearToken, loadToken, saveToken } from "./auth/token-store";
import { runAudit } from "./engine/audit";
import { addRepo, listRepos, removeRepo } from "./store/repos";

// In dev the renderer is served by Vite (HMR needs a looser policy); in prod it
// loads from the bundle under a strict self-only policy. Either way: no remote
// origins, ever.
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(DEV_RENDERER_URL);

// Dev convenience: load apps/desktop/.env into process.env so config like the
// GitHub client id persists across restarts without exporting it each time. The
// values aren't secret (an OAuth client id is public) and the file is gitignored.
if (isDev) {
  try {
    const envFile = readFileSync(
      join(import.meta.dirname, "../../.env"),
      "utf8",
    );
    for (const line of envFile.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1];
      if (key && process.env[key] === undefined) {
        process.env[key] = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .env — fine
  }
}

/** GitHub App / OAuth client id for device flow (ADR-0007). Empty → not set up. */
const GITHUB_CLIENT_ID = process.env.FACTORY_GITHUB_CLIENT_ID ?? "";
const GITHUB_SCOPE = "repo read:org";

let mainWindow: BrowserWindow | null = null;

function sendAuthUpdate(update: AuthUpdate): void {
  mainWindow?.webContents.send(IpcChannel.AuthUpdate, update);
}

/** Hosts `shell.openExternal` is allowed to hand to the OS browser. */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "github.com",
  "docs.github.com",
  "www.w3.org",
]);

/** The strict production CSP (applied only to the packaged app; see below). */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'", // bundled CSS + any injected <style>
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Open an allow-listed https link in the OS browser; silently drop anything else. */
function openExternalIfAllowed(url: string): void {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "https:" &&
      ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)
    ) {
      void shell.openExternal(url);
    }
  } catch {
    // not a valid URL — ignore
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1140,
    height: 780,
    show: false,
    backgroundColor: "#0b0f17",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.once("ready-to-show", () => window.show());

  if (isDev) {
    window.webContents.openDevTools({ mode: "detach" });
    // Forward renderer console + load failures to the main-process stdout so
    // they're visible when driving the app headlessly in dev.
    window.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
      },
    );
    window.webContents.on("did-fail-load", (_event, code, desc, url) => {
      console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(
        `[renderer] render-process-gone ${JSON.stringify(details)}`,
      );
    });
  }

  // Never open a second window in-app; route an allow-listed link to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: "deny" };
  });

  // Block navigation away from our own renderer origin (no drive-by nav).
  window.webContents.on("will-navigate", (event, url) => {
    const ownOrigin = DEV_RENDERER_URL ?? "file://";
    if (!url.startsWith(ownOrigin)) {
      event.preventDefault();
      openExternalIfAllowed(url);
    }
  });

  if (DEV_RENDERER_URL) {
    void window.loadURL(DEV_RENDERER_URL);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.Ping, (_event, raw: unknown) => {
    const request = PingRequest.parse(raw); // re-validate the renderer's request
    const response: PingResponse = {
      reply: `pong: ${request.message}`,
      version: app.getVersion(),
    };
    return response;
  });

  ipcMain.handle(IpcChannel.ReposList, async () =>
    RepoList.parse(await listRepos()),
  );

  ipcMain.handle(IpcChannel.ReposAdd, async () => {
    const result = await dialog.showOpenDialog({
      title: "Add a repository folder",
      properties: ["openDirectory"],
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) {
      return RepoList.parse(await listRepos());
    }
    return RepoList.parse(await addRepo(chosen));
  });

  ipcMain.handle(IpcChannel.ReposRemove, async (_event, raw: unknown) => {
    const { path } = RepoRemoveRequest.parse(raw);
    return RepoList.parse(await removeRepo(path));
  });

  ipcMain.handle(IpcChannel.AuditRun, async (_event, raw: unknown) => {
    const { repoPath } = AuditRunRequest.parse(raw);
    const token = (await loadToken()) ?? undefined;
    return Scorecard.parse(await runAudit(repoPath, token));
  });

  ipcMain.handle(IpcChannel.AuthStatus, async () => {
    const token = await loadToken();
    if (!token) return AuthStatus.parse({ signedIn: false, login: null });
    try {
      const login = await fetchUserLogin(token, fetch);
      return AuthStatus.parse({ signedIn: true, login });
    } catch {
      // Token present but unverifiable (offline / revoked) — still "signed in".
      return AuthStatus.parse({ signedIn: true, login: null });
    }
  });

  ipcMain.handle(IpcChannel.AuthSignIn, async () => {
    if (!GITHUB_CLIENT_ID) {
      throw new Error(
        "GitHub sign-in isn't configured. Set FACTORY_GITHUB_CLIENT_ID to a " +
          "registered GitHub App/OAuth client id (ADR-0007).",
      );
    }
    const deps = { fetch };
    const code = await requestDeviceCode(GITHUB_CLIENT_ID, GITHUB_SCOPE, deps);
    // Open github.com/login/device for the user (host is allow-listed).
    openExternalIfAllowed(code.verificationUri);

    // Poll in the background; push the outcome to the renderer when it lands.
    void (async () => {
      try {
        const token = await pollForToken(GITHUB_CLIENT_ID, code, deps);
        await saveToken(token);
        let login = "";
        try {
          login = await fetchUserLogin(token, fetch);
        } catch {
          // keep login empty; the status call will refresh it
        }
        sendAuthUpdate({ status: "signed-in", login });
      } catch (err) {
        sendAuthUpdate({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return DeviceCodeInfo.parse({
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresIn: code.expiresIn,
    });
  });

  ipcMain.handle(IpcChannel.AuthSignOut, async () => {
    await clearToken();
    return AuthStatus.parse({ signedIn: false, login: null });
  });
}

app.whenReady().then(() => {
  // Enforce the strict CSP on the packaged app. In dev the renderer is the Vite
  // server (its own inline bootstrap + HMR websocket), so we rely on Vite +
  // Electron defaults there rather than fighting the policy.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [contentSecurityPolicy()],
        },
      });
    });
  }

  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}, console.error);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
