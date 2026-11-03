import { expect, test } from "@playwright/test";

import { closeApp, launchApp, type LaunchedApp } from "./helpers";

// Sign-in flow. With FACTORY_E2E the device flow is served canned responses (see
// main/index.ts), so the real handler — poll loop, safeStorage token write, the
// renderer push — runs end to end without the network.
test.describe("GitHub sign-in", () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await closeApp(launched);
  });

  test("signs in via the device flow and shows the user", async () => {
    launched = await launchApp({
      env: { FACTORY_GITHUB_CLIENT_ID: "e2e-client-id" },
    });
    const { page } = launched;

    await expect(
      page.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Sign in with GitHub" }).click();

    // The canned device flow resolves (the device-code UI may flash by first), so
    // assert the end state: the signed-in user and a sign-out control.
    await expect(page.getByText("@e2e-user")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("reports a clear error when sign-in isn't configured", async () => {
    launched = await launchApp(); // no client id
    const { page } = launched;

    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await expect(page.getByRole("alert")).toContainText(/isn't configured/i);
  });
});
