import { defineConfig } from "@playwright/test";

// Electron end-to-end tests. Each spec launches the built app (out/main) via
// Playwright's _electron, so the renderer, preload, IPC, and engine adapters all
// run for real. Serial (one Electron instance at a time); the `e2e` script builds
// the app first. Run headless in CI under xvfb.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
});
