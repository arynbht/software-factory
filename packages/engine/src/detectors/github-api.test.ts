import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { githubApi } from "./github-api.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const REPO = "https://api.github.com/repos/o/r";

function ctx() {
  return buildContext("/virtual/repo", {
    token: "test-token",
    github: { owner: "o", repo: "r" },
  });
}

function repoHandler(data: Record<string, unknown>) {
  return http.get(REPO, () =>
    HttpResponse.json({ default_branch: "main", private: false, ...data }),
  );
}

describe("githubApi", () => {
  it("skips when there is no token", async () => {
    const offline = buildContext("/virtual/repo", {
      github: { owner: "o", repo: "r" },
    });
    const result = await githubApi(offline, {
      type: "github-api",
      check: "branch-protection",
    });
    expect(result.status).toBe("skip");
  });

  it("skips branch-protection when permission is denied for both endpoints", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/branches/main/protection`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
      http.get(`${REPO}/rules/branches/main`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "branch-protection",
    });
    expect(result.status).toBe("skip");
    expect(result.message).toMatch(/installation token/i);
  });

  it("passes default-branch when it equals the expected value", async () => {
    server.use(repoHandler({ default_branch: "main" }));
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "default-branch",
      equals: "main",
    });
    expect(result.status).toBe("pass");
  });

  it("fails branch-protection when neither classic protection nor rules exist", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/branches/main/protection`, () =>
        HttpResponse.json({ message: "Branch not protected" }, { status: 404 }),
      ),
      http.get(`${REPO}/rules/branches/main`, () => HttpResponse.json([])),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "branch-protection",
    });
    expect(result.status).toBe("fail");
  });

  it("passes branch-protection via classic protection", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/branches/main/protection`, () =>
        HttpResponse.json({ required_pull_request_reviews: {} }),
      ),
      http.get(`${REPO}/rules/branches/main`, () => HttpResponse.json([])),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "branch-protection",
    });
    expect(result.status).toBe("pass");
  });

  it("passes branch-protection via a repository ruleset (no classic protection)", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/branches/main/protection`, () =>
        HttpResponse.json({ message: "Branch not protected" }, { status: 404 }),
      ),
      http.get(`${REPO}/rules/branches/main`, () =>
        HttpResponse.json([
          { type: "pull_request" },
          { type: "non_fast_forward" },
        ]),
      ),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "branch-protection",
    });
    expect(result.status).toBe("pass");
    expect(result.message).toMatch(/ruleset/i);
  });

  it("fails branch-protection when the ruleset has only non-gating rules", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/branches/main/protection`, () =>
        HttpResponse.json({ message: "Branch not protected" }, { status: 404 }),
      ),
      http.get(`${REPO}/rules/branches/main`, () =>
        HttpResponse.json([{ type: "non_fast_forward" }, { type: "deletion" }]),
      ),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "branch-protection",
    });
    expect(result.status).toBe("fail");
  });

  it("passes required-pull-request via a ruleset", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/branches/main/protection`, () =>
        HttpResponse.json({ message: "Branch not protected" }, { status: 404 }),
      ),
      http.get(`${REPO}/rules/branches/main`, () =>
        HttpResponse.json([{ type: "pull_request" }]),
      ),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "required-pull-request",
    });
    expect(result.status).toBe("pass");
  });

  it("reads secret-scanning push protection from security_and_analysis", async () => {
    server.use(
      repoHandler({
        security_and_analysis: {
          secret_scanning_push_protection: { status: "enabled" },
        },
      }),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "secret-scanning-push-protection",
    });
    expect(result.status).toBe("pass");
  });

  it("skips secret-scanning when security settings are unreadable", async () => {
    server.use(repoHandler({}));
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "secret-scanning",
    });
    expect(result.status).toBe("skip");
    expect(result.message).toMatch(/Administration/i);
  });

  it("passes dependabot-security-updates when enabled", async () => {
    server.use(
      repoHandler({}),
      http.get(`${REPO}/automated-security-fixes`, () =>
        HttpResponse.json({ enabled: true, paused: false }),
      ),
    );
    const result = await githubApi(ctx(), {
      type: "github-api",
      check: "dependabot-security-updates",
    });
    expect(result.status).toBe("pass");
  });

  it("caches the repo GET across checks in one run", async () => {
    let calls = 0;
    server.use(
      http.get(REPO, () => {
        calls += 1;
        return HttpResponse.json({ default_branch: "main", private: false });
      }),
    );
    const shared = ctx();
    await githubApi(shared, { type: "github-api", check: "default-branch" });
    await githubApi(shared, { type: "github-api", check: "visibility" });
    expect(calls).toBe(1);
  });
});
