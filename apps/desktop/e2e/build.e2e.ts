import { expect, test } from "@playwright/test";

import {
  closeApp,
  copyFixtureRepo,
  launchApp,
  type LaunchedApp,
} from "./helpers";

// Build tab: under the E2E seam the orchestrator is gated off (it would spawn real
// write-agents), so planning reports the CLI is unavailable. This verifies the tab,
// the describe→plan IPC round-trip, and the graceful gating — without building.
test.describe("build", () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await closeApp(launched);
  });

  test("renders the Build tab and reports gating when the CLI is unavailable", async () => {
    const repoPath = copyFixtureRepo();
    launched = await launchApp({
      repos: [{ path: repoPath, name: "sample-repo" }],
    });
    const { page } = launched;

    await page
      .getByRole("button", { name: /sample-repo/ })
      .first()
      .click();
    await page.getByRole("tab", { name: "Build" }).click();

    const panel = page.locator("#panel-build");
    await expect(panel.getByRole("heading", { name: "Build" })).toBeVisible();

    await panel
      .getByPlaceholder(/Add CSV export/)
      .fill("add a greeting endpoint");
    await panel.getByRole("button", { name: "Plan" }).click();

    // The round-trip returns buildAvailable:false under the E2E seam.
    await expect(
      panel.getByText(/Building needs the Claude Code CLI/),
    ).toBeVisible();
  });
});
