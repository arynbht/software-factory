import { describe, expect, it, vi } from "vitest";

import { checkForUpdate, isNewer } from "./check";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("isNewer", () => {
  it("compares semver-ish versions numerically", () => {
    expect(isNewer("1.2.0", "1.1.9")).toBe(true);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
    expect(isNewer("1.0.10", "1.0.9")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.1")).toBe(false);
  });

  it("ignores a leading v, a pkg@ prefix, and prerelease suffixes", () => {
    expect(isNewer("v1.2.0", "1.1.0")).toBe(true);
    expect(isNewer("factory-desktop@1.2.0", "1.1.0")).toBe(true);
    expect(isNewer("1.2.0-beta.1", "1.2.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  const base = { repo: "owner/app", token: "gho_x" };

  it("reports an available update from the latest release", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          tag_name: "v1.4.0",
          html_url: "https://github.com/owner/app/releases/tag/v1.4.0",
          published_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    const info = await checkForUpdate({
      ...base,
      fetch: fetchMock,
      currentVersion: "1.3.0",
    });
    expect(info.updateAvailable).toBe(true);
    expect(info.latestVersion).toBe("v1.4.0");
    expect(info.url).toContain("releases/tag/v1.4.0");
    // sends the token for the private-repo path
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer gho_x",
    );
  });

  it("reports up to date when the latest matches the current version", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ tag_name: "v1.3.0" })),
    );
    const info = await checkForUpdate({
      ...base,
      fetch: fetchMock,
      currentVersion: "1.3.0",
    });
    expect(info.updateAvailable).toBe(false);
    expect(info.latestVersion).toBe("v1.3.0");
  });

  it("treats a 404 (no releases yet) as no update, not an error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({}, false, 404)),
    );
    const info = await checkForUpdate({
      ...base,
      fetch: fetchMock,
      currentVersion: "1.0.0",
    });
    expect(info.updateAvailable).toBe(false);
    expect(info.latestVersion).toBe(null);
  });

  it("throws a helpful message on an auth error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({}, false, 401)),
    );
    await expect(
      checkForUpdate({ ...base, fetch: fetchMock, currentVersion: "1.0.0" }),
    ).rejects.toThrow(/sign in to GitHub/);
  });
});
