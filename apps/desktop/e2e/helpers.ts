import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");

/** Path to the built main entry (the `e2e` script runs electron-vite build first). */
const APP_MAIN = join(desktopRoot, "out", "main", "index.js");

/** Absolute path to the axe-core UMD bundle, read and injected into the renderer. */
const AXE_PATH = join(desktopRoot, "node_modules", "axe-core", "axe.min.js");

export interface RepoSeed {
  path: string;
  name: string;
}

export interface LaunchOptions {
  /** repos.json contents to seed (so a repo appears without the native picker). */
  repos?: RepoSeed[];
  /** settings.json overrides merged over the defaults used here. */
  settings?: Record<string, unknown>;
  /** Extra env for the main process (e.g. FACTORY_GITHUB_CLIENT_ID). */
  env?: Record<string, string>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

/** Copy the committed fixture repo into a fresh temp dir so tests can write to it. */
export function copyFixtureRepo(name = "sample-repo"): string {
  const src = join(desktopRoot, "e2e", "fixtures", name);
  const dest = mkdtempSync(join(tmpdir(), `factory-e2e-repo-`));
  cpSync(src, dest, { recursive: true });
  return dest;
}

/**
 * Launch the built Electron app with an isolated userData dir (seeded with the
 * given repos/settings) and the E2E seam enabled. Returns the app + first window.
 */
export async function launchApp(
  opts: LaunchOptions = {},
): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), "factory-e2e-userdata-"));
  mkdirSync(userDataDir, { recursive: true });

  if (opts.repos) {
    writeFileSync(
      join(userDataDir, "repos.json"),
      JSON.stringify(opts.repos, null, 2),
    );
  }
  // Default settings keep the launch update-check off so tests never hit the network.
  const settings = {
    theme: "dark",
    defaultOrg: "",
    aiPreferApiKey: false,
    autoCheckUpdates: false,
    ...opts.settings,
  };
  writeFileSync(
    join(userDataDir, "settings.json"),
    JSON.stringify(settings, null, 2),
  );

  const app = await electron.launch({
    args: [
      APP_MAIN,
      `--user-data-dir=${userDataDir}`,
      // Chromium's sandbox needs root privileges it doesn't have under CI; the
      // app's BrowserWindow sandbox (and the packaged fuses) are unaffected.
      "--no-sandbox",
      // Headless CI (xvfb) has no real GPU and a small /dev/shm; without these the
      // renderer can hang before the window ever opens. Harmless on a dev machine.
      "--disable-gpu",
      "--disable-dev-shm-usage",
      // Use the plaintext credential store so safeStorage works headless (no OS
      // keyring in CI). Test-only — the packaged app uses the real keychain.
      "--password-store=basic",
    ],
    env: {
      ...process.env,
      FACTORY_E2E: "1",
      // The app appends lifecycle markers here (fs is immune to the stdio-pipe quirk
      // that swallowed its stdout/stderr on headless CI). Dumped below if launch fails.
      FACTORY_E2E_DIAG: join(userDataDir, "e2e-diag.log"),
      ...opts.env,
    },
  });

  // Surface main-process output so a launch failure is diagnosable in CI logs.
  app.process().stderr?.on("data", (d: Buffer) => {
    process.stderr.write(`[electron:err] ${d.toString()}`);
  });
  app.process().stdout?.on("data", (d: Buffer) => {
    process.stderr.write(`[electron:out] ${d.toString()}`);
  });

  let page: Page;
  try {
    page = await app.firstWindow();
  } catch (err) {
    // firstWindow timed out on CI with no window. Dump the file-based lifecycle log
    // so we can see how far the main process got (module body? ready? window?).
    let diag = "(no diag file)";
    try {
      diag = readFileSync(join(userDataDir, "e2e-diag.log"), "utf8");
    } catch {
      /* no file — the module body never ran */
    }
    process.stderr.write(`\n[e2e-diag] main-process lifecycle:\n${diag}\n`);
    throw err;
  }
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userDataDir };
}

/** Tear down an app and remove its temp userData dir. */
export async function closeApp(launched: LaunchedApp): Promise<void> {
  // Surface the main-process lifecycle log (CI diagnosis) before the dir is removed.
  try {
    const diag = readFileSync(
      join(launched.userDataDir, "e2e-diag.log"),
      "utf8",
    );
    if (diag.trim()) process.stderr.write(`[e2e-diag]\n${diag}`);
  } catch {
    /* no diag file */
  }
  await launched.app.close();
  rmSync(launched.userDataDir, { recursive: true, force: true });
}

export interface AxeResult {
  violations: {
    id: string;
    impact: string | null;
    help: string;
    nodes: { target: string[] }[];
  }[];
}

/**
 * Run axe-core against the current page and return violations at or above
 * `serious` (the actionable tier; `moderate`/`minor` are advisory). axe is injected
 * as inline script — the E2E CSP allows that; production stays `script-src 'self'`.
 */
export async function runAxe(page: Page): Promise<AxeResult["violations"]> {
  const axeSource = readFileSync(AXE_PATH, "utf8");
  await page.evaluate((src) => {
    // Inject axe-core into the page (the E2E CSP permits inline script).
    window.eval(src);
  }, axeSource);

  const result = (await page.evaluate(async () => {
    // @ts-expect-error — axe is attached to window by the injected source.
    return (await window.axe.run(document, {
      resultTypes: ["violations"],
    })) as AxeResult;
  })) as AxeResult;

  const actionable = new Set(["serious", "critical"]);
  return result.violations.filter(
    (v) => v.impact !== null && actionable.has(v.impact),
  );
}
