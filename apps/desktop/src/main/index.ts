import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

import {
  AuditRunRequest,
  IpcChannel,
  PingRequest,
  type PingResponse,
  RepoList,
  RepoRemoveRequest,
  Scorecard,
} from "../shared/ipc";
import { runAudit } from "./engine/audit";
import { addRepo, listRepos, removeRepo } from "./store/repos";

// In dev the renderer is served by Vite (HMR needs a looser policy); in prod it
// loads from the bundle under a strict self-only policy. Either way: no remote
// origins, ever.
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(DEV_RENDERER_URL);

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
    return Scorecard.parse(await runAudit(repoPath));
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
