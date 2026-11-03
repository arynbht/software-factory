import { expect, test } from "@playwright/test";

import {
  closeApp,
  copyFixtureRepo,
  launchApp,
  type LaunchedApp,
  runAxe,
} from "./helpers";

// axe-core accessibility checks on each screen. Fails on any serious/critical
// violation (missing labels, roles, contrast, etc.).
test.describe("accessibility (axe)", () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await closeApp(launched);
  });

  test("each screen is free of serious/critical axe violations", async () => {
    const repoPath = copyFixtureRepo();
    launched = await launchApp({
      repos: [{ path: repoPath, name: "sample-repo" }],
    });
    const { page } = launched;

    // Empty state (no repo selected).
    expect(await runAxe(page), "empty state").toEqual([]);

    await page
      .getByRole("button", { name: /sample-repo/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(
      page
        .locator("#panel-scorecard")
        .getByRole("heading", { name: "Scorecard" }),
    ).toBeVisible();
    expect(await runAxe(page), "scorecard").toEqual([]);

    await page.getByRole("tab", { name: "Profile" }).click();
    await expect(
      page.locator("#panel-profile").getByRole("heading", { name: "Profile" }),
    ).toBeVisible();
    expect(await runAxe(page), "profile").toEqual([]);

    await page.getByRole("tab", { name: "Gates" }).click();
    await expect(
      page.locator("#panel-gates").getByRole("heading", { name: "Gates" }),
    ).toBeVisible();
    expect(await runAxe(page), "gates").toEqual([]);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(await runAxe(page), "settings").toEqual([]);
  });
});
