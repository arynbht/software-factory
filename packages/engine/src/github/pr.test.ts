import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildContext, type GitHubClient } from "../context.js";
import { openOrReusePr } from "./pr.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const REPO = "https://api.github.com/repos/o/r";

async function client(): Promise<GitHubClient> {
  const gh = await buildContext("/tmp/x", {
    token: "t",
    github: { owner: "o", repo: "r" },
  }).github();
  if (!gh) throw new Error("expected a github client");
  return gh;
}

describe("openOrReusePr", () => {
  it("creates a PR when none is open for the branch", async () => {
    let createdBody: unknown;
    server.use(
      http.get(`${REPO}/pulls`, () => HttpResponse.json([])),
      http.post(`${REPO}/pulls`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({
          number: 7,
          html_url: "https://github.com/o/r/pull/7",
        });
      }),
    );

    const pr = await openOrReusePr(await client(), {
      head: "factory/2026-11-01-scaffold",
      base: "main",
      title: "factory: 2 fixes for scaffold",
      body: "body",
    });

    expect(pr).toEqual({
      number: 7,
      url: "https://github.com/o/r/pull/7",
      reused: false,
    });
    expect(createdBody).toMatchObject({
      head: "factory/2026-11-01-scaffold",
      base: "main",
      title: "factory: 2 fixes for scaffold",
    });
  });

  it("reuses and updates the existing open PR for the branch", async () => {
    let updated: unknown;
    server.use(
      http.get(`${REPO}/pulls`, () =>
        HttpResponse.json([
          { number: 42, html_url: "https://github.com/o/r/pull/42" },
        ]),
      ),
      http.patch(`${REPO}/pulls/42`, async ({ request }) => {
        updated = await request.json();
        return HttpResponse.json({
          number: 42,
          html_url: "https://github.com/o/r/pull/42",
        });
      }),
    );

    const pr = await openOrReusePr(await client(), {
      head: "factory/2026-11-01-scaffold",
      base: "main",
      title: "factory: 3 fixes for scaffold",
      body: "updated body",
    });

    expect(pr).toEqual({
      number: 42,
      url: "https://github.com/o/r/pull/42",
      reused: true,
    });
    expect(updated).toMatchObject({
      title: "factory: 3 fixes for scaffold",
      body: "updated body",
    });
  });

  it("propagates an API error (e.g. 500) rather than swallowing it", async () => {
    server.use(
      http.get(`${REPO}/pulls`, () => HttpResponse.json([])),
      http.post(`${REPO}/pulls`, () => new HttpResponse(null, { status: 500 })),
    );
    await expect(
      openOrReusePr(await client(), {
        head: "factory/2026-11-01-scaffold",
        base: "main",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow();
  });
});
