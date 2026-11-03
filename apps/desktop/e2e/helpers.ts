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
      // Use the plaintext credential store so safeStorage works headless (no OS
      // keyring in CI). Test-only — the packaged app uses the real keychain.
      "--password-store=basic",
    ],
    env: {
      ...process.env,
      FACTORY_E2E: "1",
      ...opts.env,
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userDataDir };
}

/** Tear down an app and remove its temp userData dir. */
export async function closeApp(launched: LaunchedApp): Promise<void> {
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
