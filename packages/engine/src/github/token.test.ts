import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveToken } from "./token.js";

describe("resolveToken", () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("prefers an explicit token", () => {
    process.env.GITHUB_TOKEN = "from-env";
    expect(resolveToken("explicit")).toBe("explicit");
  });

  it("falls back to GITHUB_TOKEN then GH_TOKEN", () => {
    process.env.GH_TOKEN = "gh-token";
    expect(resolveToken()).toBe("gh-token");
    process.env.GITHUB_TOKEN = "github-token";
    expect(resolveToken()).toBe("github-token");
  });
});
