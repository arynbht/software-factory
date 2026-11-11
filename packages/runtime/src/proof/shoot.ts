// Screenshots at three breakpoints, and an axe pass, with Playwright's own
// Chromium (`npx playwright install chromium` is the one install it needs).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import type { Browser } from "playwright-core";

export const BREAKPOINTS = [
  { name: "sm", width: 375, height: 812 },
  { name: "md", width: 768, height: 1024 },
  { name: "lg", width: 1280, height: 800 },
] as const;

export interface Shot {
  page: string;
  breakpoint: string;
  /** Absolute path of the PNG. */
  file: string;
  /** The page's HTTP status (0 when there was no response). */
  status: number;
}

export interface AxeViolation {
  id: string;
  impact: string;
  page: string;
  nodes: number;
}

/** A page path as a file-name part: "/" → "home", "/settings/a" → "settings-a". */
export function pageSlug(page: string): string {
  return (
    page
      .replace(/[?#].*$/, "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase() || "home"
  );
}

async function launch(): Promise<Browser> {
  // Loaded on use: only the prove beat needs a browser (and the Action's
  // bundle leaves Playwright out).
  const { chromium } = await import("playwright-core");
  try {
    return await chromium.launch();
  } catch (first) {
    // Fall back to an installed Chrome or Edge before giving up.
    for (const channel of ["chrome", "msedge"]) {
      try {
        return await chromium.launch({ channel });
      } catch {
        // next
      }
    }
    throw new Error(
      `no browser for the UI proof: run \`npx playwright install chromium\` (${(first as Error).message.split("\n")[0]})`,
    );
  }
}

/** Can the UI proof run here? (False with no Chromium, Chrome or Edge.) */
export async function browserAvailable(): Promise<boolean> {
  try {
    await (await launch()).close();
    return true;
  } catch {
    return false;
  }
}

const axeSource = async (): Promise<string> =>
  readFile(
    createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
    "utf8",
  );

/**
 * Shoot every page at every breakpoint into `outDir` as
 * `<prefix>-<n>-<page>-<breakpoint>.png` (n keeps similar pages apart); with `axe`, also return the serious and
 * critical violations on each page (at the largest breakpoint).
 */
export async function shoot(options: {
  baseUrl: string;
  pages: readonly string[];
  outDir: string;
  prefix: string;
  axe?: boolean | undefined;
}): Promise<{ shots: Shot[]; violations: AxeViolation[] }> {
  const browser = await launch();
  const shots: Shot[] = [];
  const violations: AxeViolation[] = [];
  const source = options.axe ? await axeSource() : "";
  try {
    // Pages are paths under the app's URL, which may have a base path.
    const root = options.baseUrl.endsWith("/")
      ? options.baseUrl
      : `${options.baseUrl}/`;
    for (const [i, path] of options.pages.entries()) {
      const url = new URL(path.replace(/^\/+/, ""), root).toString();
      for (const bp of BREAKPOINTS) {
        // bypassCSP: the axe script is injected inline, which an app's own
        // Content-Security-Policy would (rightly, for users) block.
        const page = await browser.newPage({
          bypassCSP: true,
          viewport: { width: bp.width, height: bp.height },
        });
        const res = await page.goto(url, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        const file = join(
          options.outDir,
          `${options.prefix}-${i + 1}-${pageSlug(path)}-${bp.name}.png`,
        );
        await page.screenshot({ path: file, fullPage: true });
        shots.push({
          page: path,
          breakpoint: bp.name,
          file,
          status: res?.status() ?? 0,
        });
        if (options.axe && bp.name === "lg") {
          await page.addScriptTag({ content: source });
          const found = await page.evaluate(async () => {
            const axe = (
              globalThis as unknown as {
                axe: {
                  run(): Promise<{
                    violations: {
                      id: string;
                      impact: string | null;
                      nodes: unknown[];
                    }[];
                  }>;
                };
              }
            ).axe;
            const result = await axe.run();
            return result.violations.map((v) => ({
              id: v.id,
              impact: v.impact ?? "minor",
              nodes: v.nodes.length,
            }));
          });
          for (const v of found) {
            if (v.impact === "serious" || v.impact === "critical")
              violations.push({ ...v, page: path });
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { shots, violations };
}
