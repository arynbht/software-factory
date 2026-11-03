import { expect, test } from "@playwright/test";

import {
  closeApp,
  copyFixtureRepo,
  launchApp,
  type LaunchedApp,
} from "./helpers";

// Floor Plan flow: the fixture ships a seeded `.factory/floorplan.json`, so the
// tab renders the persisted repository model without needing the Claude CLI (which
// CI doesn't have). This verifies the tab, the graph container, and the model
// summary — the deterministic half of the deep-audit feature.
test.describe("floor plan", () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await closeApp(launched);
  });

  test("renders the persisted repository model", async () => {
    const repoPath = copyFixtureRepo();
    launched = await launchApp({
      repos: [{ path: repoPath, name: "sample-repo" }],
    });
    const { page } = launched;

    await page
      .getByRole("button", { name: /sample-repo/ })
      .first()
      .click();

    await page.getByRole("tab", { name: "Floor Plan" }).click();

    const panel = page.locator("#panel-floorplan");
    await expect(
      panel.getByRole("heading", { name: "Floor Plan" }),
    ).toBeVisible();
    // The summary line proves the persisted model loaded over IPC.
    await expect(panel.getByText(/\d+ systems · \d+ nodes/)).toBeVisible();
  });
});
