import { expect, test } from "@playwright/test";

import {
  closeApp,
  copyFixtureRepo,
  launchApp,
  type LaunchedApp,
} from "./helpers";

// Audit flow: a seeded local repo → select it → Run audit → lane scorecard.
test.describe("audit", () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await closeApp(launched);
  });

  test("runs an audit and renders the scorecard", async () => {
    const repoPath = copyFixtureRepo();
    launched = await launchApp({
      repos: [{ path: repoPath, name: "sample-repo" }],
    });
    const { page } = launched;

    // The seeded repo appears in the sidebar; select it.
    await page
      .getByRole("button", { name: /sample-repo/ })
      .first()
      .click();

    await page.getByRole("button", { name: "Run audit" }).click();

    const panel = page.locator("#panel-scorecard");
    await expect(
      panel.getByRole("heading", { name: "Scorecard" }),
    ).toBeVisible();
    // The totals line proves real control results came back from the engine.
    await expect(panel.getByText(/\d+ controls ·/)).toBeVisible();
  });
});
