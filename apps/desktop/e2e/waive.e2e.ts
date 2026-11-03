import { expect, test } from "@playwright/test";

import {
  closeApp,
  copyFixtureRepo,
  launchApp,
  type LaunchedApp,
} from "./helpers";

// Waive flow: on the Gates screen, waive a blocking control and confirm it drops
// out of the gate's blockers (it's now waived, written to .factory/waivers.yml).
test.describe("waive", () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await closeApp(launched);
  });

  test("waives a blocker and it leaves the gate", async () => {
    const repoPath = copyFixtureRepo();
    launched = await launchApp({
      repos: [{ path: repoPath, name: "sample-repo" }],
    });
    const { page } = launched;

    await page
      .getByRole("button", { name: /sample-repo/ })
      .first()
      .click();
    await page.getByRole("tab", { name: "Gates" }).click();

    const panel = page.locator("#panel-gates");
    await expect(panel.getByRole("heading", { name: "Gates" })).toBeVisible();

    // Make sure a phase with blockers is expanded so its Waive buttons render.
    let waive = panel.getByRole("button", { name: /^Waive / });
    if ((await waive.count()) === 0) {
      await panel
        .getByRole("button", { name: /blocking/ })
        .first()
        .click();
    }
    waive = panel.getByRole("button", { name: /^Waive / });
    await expect(waive.first()).toBeVisible();

    const label = await waive.first().getAttribute("aria-label");
    expect(label).toBeTruthy();

    await waive.first().click();
    await panel.getByLabel("Waiver reason").first().fill("e2e test waiver");
    await panel.getByRole("button", { name: "Save" }).first().click();

    // After the waiver is written and gates recompute, that blocker is gone.
    await expect(
      panel.getByRole("button", { name: label as string }),
    ).toHaveCount(0);
  });
});
