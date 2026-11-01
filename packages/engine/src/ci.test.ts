import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { Octokit } from "@octokit/rest";

import {
  FACTORY_MARKER,
  upsertStatusIssue,
  upsertStickyComment,
} from "./ci.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const octokit = (): Octokit => new Octokit({ auth: "test-token" });
const COMMENTS = "https://api.github.com/repos/o/r/issues/7/comments";
const ISSUES = "https://api.github.com/repos/o/r/issues";

describe("upsertStickyComment", () => {
  it("creates a comment when none exists", async () => {
    let created = false;
    server.use(
      http.get(COMMENTS, () => HttpResponse.json([])),
      http.post(COMMENTS, () => {
        created = true;
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    await upsertStickyComment(octokit(), "o", "r", 7, "hi");
    expect(created).toBe(true);
  });

  it("updates the existing marked comment", async () => {
    let updatedId: number | null = null;
    server.use(
      http.get(COMMENTS, () =>
        HttpResponse.json([{ id: 42, body: `${FACTORY_MARKER}\nold` }]),
      ),
      http.patch("https://api.github.com/repos/o/r/issues/comments/42", () => {
        updatedId = 42;
        return HttpResponse.json({ id: 42 });
      }),
    );
    await upsertStickyComment(octokit(), "o", "r", 7, "new");
    expect(updatedId).toBe(42);
  });
});

describe("upsertStatusIssue", () => {
  it("creates an issue when red and none exists", async () => {
    let created = false;
    server.use(
      http.get(ISSUES, () => HttpResponse.json([])),
      http.post(ISSUES, () => {
        created = true;
        return HttpResponse.json({ number: 1 }, { status: 201 });
      }),
    );
    await upsertStatusIssue(octokit(), "o", "r", "gaps", false);
    expect(created).toBe(true);
  });

  it("closes the existing issue when all green", async () => {
    let closedState: string | null = null;
    server.use(
      http.get(ISSUES, () =>
        HttpResponse.json([{ number: 9, title: "Factory status" }]),
      ),
      http.patch(`${ISSUES}/9`, async ({ request }) => {
        const body = (await request.json()) as { state?: string };
        closedState = body.state ?? null;
        return HttpResponse.json({ number: 9 });
      }),
    );
    await upsertStatusIssue(octokit(), "o", "r", "all good", true);
    expect(closedState).toBe("closed");
  });

  it("does nothing when all green and no issue exists", async () => {
    server.use(http.get(ISSUES, () => HttpResponse.json([])));
    await expect(
      upsertStatusIssue(octokit(), "o", "r", "all good", true),
    ).resolves.toBeUndefined();
  });
});
