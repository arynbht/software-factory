import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

import {
  FLAG_KEYS,
  LANES,
  PHASES,
  PROJECT_TYPES,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import { loadProfile, updateProfile } from "@arynbht/factory-engine";

import {
  AiApplyRequest,
  AiRunRequest,
  AiTasks,
  AnthropicKeyRequest,
  AuditRunRequest,
  DocList,
  DocsListRequest,
  DocsReadRequest,
  FloorPlanGetRequest,
  FloorPlanRunRequest,
  FloorPlanView,
  AuthStatus,
  type AuthUpdate,
  DeviceCodeInfo,
  IpcChannel,
  PingRequest,
  type PingResponse,
  EvidenceRequest,
  FixPlanRequest,
  GatesStatusRequest,
  ProfileLoadRequest,
  ProfileMeta,
  ProfileSaveRequest,
  RepoList,
  RepoRemoveRequest,
  Scorecard,
  SettingsSaveRequest,
  SettingsView,
  UpdateInfo,
  WaiveRequest,
} from "../shared/ipc";
import {
  clearAnthropicKey,
  hasAnthropicKey,
  loadAnthropicKey,
  saveAnthropicKey,
} from "./auth/anthropic-key-store";
import {
  fetchUserLogin,
  pollForToken,
  requestDeviceCode,
} from "./auth/device-flow";
import {
  type AiOptions,
  applyAiDraft,
  listAiTasks,
  openAiPr,
  runAiTask,
} from "./engine/ai";
import { clearToken, loadToken, saveToken } from "./auth/token-store";
import { runAudit } from "./engine/audit";
import { getFloorPlan, runFloorPlan } from "./engine/floorplan";
import { listDocs, readDoc } from "./engine/docs";
import { applyFix, openFixPrForRepo, planFix } from "./engine/fix";
import { attachEvidence, computeGates, waiveControl } from "./engine/gates";
import { addRepo, listRepos, removeRepo } from "./store/repos";
import { loadSettings, saveSettings } from "./store/settings";
import { checkForUpdate } from "./update/check";

/** Enum lists that drive the renderer's Profile form (keeps the catalog out of it). */
function buildProfileMeta(): ProfileMeta {
  return {
    types: [...PROJECT_TYPES],
    phases: PHASES.map((p) => ({ key: p.key, title: p.title })),
    flags: [...FLAG_KEYS],
    lanes: LANES.map((l) => ({ key: l.key, title: l.title })),
    severities: [...SEVERITIES],
  };
}

/** The owner/repo whose releases the manual update check queries (ADR-0010). */
const UPDATE_REPO =
  process.env.FACTORY_UPDATE_REPO ?? "arynbht/software-factory";

/** Resolve the AI transport options from settings + the stored Anthropic key. */
async function resolveAiOptions(): Promise<AiOptions> {
  const [settings, apiKey] = await Promise.all([
    loadSettings(),
    loadAnthropicKey(),
  ]);
  return {
    ...(apiKey ? { apiKey } : {}),
    preferApiKey: settings.aiPreferApiKey,
  };
}

/** The renderer-facing settings: the stored prefs plus whether a key is set. */
async function settingsView(): Promise<SettingsView> {
  const [settings, anthropicKeySet] = await Promise.all([
    loadSettings(),
    hasAnthropicKey(),
  ]);
  return { ...settings, anthropicKeySet };
}

// In dev the renderer is served by Vite (HMR needs a looser policy); in prod it
// loads from the bundle under a strict self-only policy. Either way: no remote
// origins, ever.
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(DEV_RENDERER_URL);
// End-to-end test mode (Playwright): loosens the CSP enough to inject axe-core and
// routes sign-in through a canned device flow so the suite runs without the network.
// Never set in a real session — it gates test-only seams, nothing user-facing.
const isE2E = process.env.FACTORY_E2E === "1";

/** Canned responses for the GitHub device-flow + user endpoints (E2E only). */
function e2eDeviceFlowFetch(input: unknown): Promise<Response> {
  const href = String(input);
  const body = href.includes("/device/code")
    ? {
        device_code: "e2e-device",
        user_code: "E2E-CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 0,
      }
    : href.includes("/oauth/access_token")
      ? { access_token: "e2e-token" }
      : href.includes("/user")
        ? { login: "e2e-user" }
        : {};
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Real fetch, or the canned device-flow fetch in E2E, for auth calls only. */
const authFetch: typeof fetch = isE2E
  ? (e2eDeviceFlowFetch as unknown as typeof fetch)
  : fetch;

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

/**
 * Cancels the in-flight device-flow poll. A new sign-in or an explicit sign-out
 * aborts the previous poller so a stale one can't overwrite the token or push a
 * late outcome to the renderer.
 */
let signInAbort: AbortController | null = null;

/** Cancels an in-flight deep-audit swarm when a newer run supersedes it. */
let floorPlanAbort: AbortController | null = null;

function sendAuthUpdate(update: AuthUpdate): void {
  mainWindow?.webContents.send(IpcChannel.AuthUpdate, update);
}

/** Hosts `shell.openExternal` is allowed to hand to the OS browser. */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "github.com",
  "docs.github.com",
  "www.w3.org",
]);

/**
 * Content-Security-Policy applied to every response. Strict self-only in prod; in
 * dev it's loosened only as far as Vite's HMR needs (inline/eval bootstrap + ws),
 * never fully policy-free — the Docs screen renders arbitrary repo Markdown, so
 * even a dev session gets a CSP backstop.
 */
function contentSecurityPolicy(): string {
  const base = [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'", // bundled CSS + any injected <style>
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ];
  if (isDev || isE2E) {
    // E2E needs inline <script> so Playwright can inject axe-core for the audit.
    base.push(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' ws: http://localhost:*",
    );
  } else {
    base.push("script-src 'self'", "connect-src 'self'");
  }
  return base.join("; ");
}

/** The exact URL our renderer loads from (the only navigation we allow in-window). */
function rendererUrl(): string {
  return (
    DEV_RENDERER_URL ??
    pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href
  );
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

  // Show as soon as the first paint is ready; in E2E show immediately so a slow or
  // non-painting headless renderer can't keep the window (and Playwright) waiting.
  if (isE2E) window.show();
  else window.once("ready-to-show", () => window.show());

  if (isDev || isE2E) {
    if (isDev) window.webContents.openDevTools({ mode: "detach" });
    // Forward renderer console + load failures to the main process so they're
    // visible when driving the app headlessly (dev or E2E on CI).
    window.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        console.error(`[renderer:${level}] ${message} (${sourceId}:${line})`);
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

  // Block navigation anywhere but our own renderer URL (prefix covers #hash and
  // ?query). A bare "file://" prefix would let any local file through, so match
  // the exact renderer URL instead.
  const allowedPrefix = rendererUrl();
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(allowedPrefix)) {
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

  ipcMain.handle(IpcChannel.FloorPlanGet, async (_event, raw: unknown) => {
    const { repoPath } = FloorPlanGetRequest.parse(raw);
    return FloorPlanView.parse(await getFloorPlan(repoPath));
  });

  ipcMain.handle(IpcChannel.FloorPlanRun, async (_event, raw: unknown) => {
    const { repoPath } = FloorPlanRunRequest.parse(raw);
    // Supersede any swarm already running (e.g. a second Run audit click).
    floorPlanAbort?.abort();
    const controller = new AbortController();
    floorPlanAbort = controller;
    try {
      const view = await runFloorPlan(
        repoPath,
        (p) => mainWindow?.webContents.send(IpcChannel.FloorPlanProgress, p),
        controller.signal,
      );
      return FloorPlanView.parse(view);
    } finally {
      if (floorPlanAbort === controller) floorPlanAbort = null;
    }
  });

  ipcMain.handle(IpcChannel.AuthStatus, async () => {
    const token = await loadToken();
    if (!token) return AuthStatus.parse({ signedIn: false, login: null });
    try {
      const login = await fetchUserLogin(token, authFetch);
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
    const deps = { fetch: authFetch };
    const code = await requestDeviceCode(GITHUB_CLIENT_ID, GITHUB_SCOPE, deps);
    // Open github.com/login/device for the user (host is allow-listed). Skipped in
    // E2E so the suite doesn't spawn a real browser.
    if (!isE2E) openExternalIfAllowed(code.verificationUri);

    // Abort any previous poll before starting a new one (double sign-in click).
    signInAbort?.abort();
    const controller = new AbortController();
    signInAbort = controller;
    const { signal } = controller;

    // Poll in the background; push the outcome to the renderer when it lands.
    // If this poll was superseded (new sign-in) or cancelled (sign-out), it must
    // not save a token or push a stale outcome.
    void (async () => {
      try {
        const token = await pollForToken(GITHUB_CLIENT_ID, code, deps, signal);
        if (signal.aborted) return;
        await saveToken(token);
        let login = "";
        try {
          login = await fetchUserLogin(token, authFetch);
        } catch {
          // keep login empty; the status call will refresh it
        }
        if (signal.aborted) return;
        sendAuthUpdate({ status: "signed-in", login });
      } catch (err) {
        if (signal.aborted) return;
        sendAuthUpdate({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (signInAbort === controller) signInAbort = null;
      }
    })();

    return DeviceCodeInfo.parse({
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresIn: code.expiresIn,
    });
  });

  ipcMain.handle(IpcChannel.AuthSignOut, async () => {
    // Stop any in-flight poll so it can't re-save a token after we clear it.
    signInAbort?.abort();
    signInAbort = null;
    await clearToken();
    return AuthStatus.parse({ signedIn: false, login: null });
  });

  ipcMain.handle(IpcChannel.ProfileMeta, () =>
    ProfileMeta.parse(buildProfileMeta()),
  );

  ipcMain.handle(IpcChannel.ProfileLoad, async (_event, raw: unknown) => {
    const { repoPath } = ProfileLoadRequest.parse(raw);
    return loadProfile(repoPath); // Profile | null, validated by the engine
  });

  ipcMain.handle(IpcChannel.ProfileSave, async (_event, raw: unknown) => {
    const { repoPath, profile } = ProfileSaveRequest.parse(raw);
    // updateProfile validates against the schema and writes a minimal diff.
    return updateProfile(repoPath, profile);
  });

  ipcMain.handle(IpcChannel.GatesStatus, async (_event, raw: unknown) => {
    const { repoPath } = GatesStatusRequest.parse(raw);
    return computeGates(repoPath, (await loadToken()) ?? undefined);
  });

  ipcMain.handle(IpcChannel.GatesWaive, async (_event, raw: unknown) => {
    const { repoPath, control, reason, expires, owner } =
      WaiveRequest.parse(raw);
    const token = (await loadToken()) ?? undefined;
    return waiveControl(
      repoPath,
      {
        control,
        reason,
        expires,
        created: new Date().toISOString().slice(0, 10),
        ...(owner ? { owner } : {}),
      },
      token,
    );
  });

  ipcMain.handle(IpcChannel.GatesEvidence, async (_event, raw: unknown) => {
    const { repoPath, control, url, note, reviewer, validFor } =
      EvidenceRequest.parse(raw);
    const token = (await loadToken()) ?? undefined;
    return attachEvidence(
      repoPath,
      {
        control,
        date: new Date().toISOString().slice(0, 10),
        ...(url ? { url } : {}),
        ...(note ? { note } : {}),
        ...(reviewer ? { reviewer } : {}),
        ...(validFor ? { "valid-for": validFor } : {}),
      },
      token,
    );
  });

  ipcMain.handle(IpcChannel.FixPlan, async (_event, raw: unknown) => {
    const { repoPath } = FixPlanRequest.parse(raw);
    return planFix(repoPath, (await loadToken()) ?? undefined);
  });

  ipcMain.handle(IpcChannel.FixApply, async (_event, raw: unknown) => {
    const { repoPath } = FixPlanRequest.parse(raw);
    return applyFix(repoPath, (await loadToken()) ?? undefined);
  });

  ipcMain.handle(IpcChannel.FixOpenPr, async (_event, raw: unknown) => {
    const { repoPath } = FixPlanRequest.parse(raw);
    const date = new Date().toISOString().slice(0, 10);
    return openFixPrForRepo(repoPath, date, (await loadToken()) ?? undefined);
  });

  ipcMain.handle(IpcChannel.AiTasks, async () =>
    AiTasks.parse(await listAiTasks()),
  );

  ipcMain.handle(IpcChannel.AiRun, async (_event, raw: unknown) => {
    const { repoPath, task } = AiRunRequest.parse(raw);
    return runAiTask(
      repoPath,
      task,
      (await loadToken()) ?? undefined,
      await resolveAiOptions(),
    );
  });

  ipcMain.handle(IpcChannel.AiApply, async (_event, raw: unknown) => {
    const { repoPath, task, outputPath, contents } = AiApplyRequest.parse(raw);
    return applyAiDraft(repoPath, task, outputPath, contents);
  });

  ipcMain.handle(IpcChannel.AiOpenPr, async (_event, raw: unknown) => {
    const { repoPath, task, outputPath, contents } = AiApplyRequest.parse(raw);
    return openAiPr(
      repoPath,
      task,
      outputPath,
      contents,
      (await loadToken()) ?? undefined,
      await resolveAiOptions(),
    );
  });

  ipcMain.handle(IpcChannel.DocsList, async (_event, raw: unknown) => {
    const { repoPath } = DocsListRequest.parse(raw);
    return DocList.parse(await listDocs(repoPath));
  });

  ipcMain.handle(IpcChannel.DocsRead, async (_event, raw: unknown) => {
    const { repoPath, path } = DocsReadRequest.parse(raw);
    return readDoc(repoPath, path);
  });

  ipcMain.handle(IpcChannel.SettingsLoad, async () =>
    SettingsView.parse(await settingsView()),
  );

  ipcMain.handle(IpcChannel.SettingsSave, async (_event, raw: unknown) => {
    const patch = SettingsSaveRequest.parse(raw);
    await saveSettings(patch);
    return SettingsView.parse(await settingsView());
  });

  ipcMain.handle(
    IpcChannel.SettingsSetAnthropicKey,
    async (_event, raw: unknown) => {
      const { key } = AnthropicKeyRequest.parse(raw);
      // An empty string clears the stored key; otherwise store it encrypted.
      if (key.trim() === "") await clearAnthropicKey();
      else await saveAnthropicKey(key.trim());
      return SettingsView.parse(await settingsView());
    },
  );

  ipcMain.handle(IpcChannel.UpdateCheck, async () => {
    const info = await checkForUpdate({
      fetch,
      currentVersion: app.getVersion(),
      repo: UPDATE_REPO,
      token: (await loadToken()) ?? undefined,
    });
    return UpdateInfo.parse(info);
  });
}

app.whenReady().then(
  () => {
    // Enforce a CSP on every response. Strict in prod; dev loosens only enough for
    // Vite's inline bootstrap + HMR websocket (see contentSecurityPolicy). The Docs
    // screen renders arbitrary repo Markdown, so even dev keeps a policy backstop.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [contentSecurityPolicy()],
        },
      });
    });

    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  },
  (err: unknown) => {
    // Make a startup failure loud (it otherwise manifests as "no window" in E2E).
    process.stderr.write(`[main] app failed to start: ${String(err)}\n`);
    console.error(err);
  },
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
