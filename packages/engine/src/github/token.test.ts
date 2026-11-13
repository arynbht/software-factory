import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveApp } from "./app.js";
import { githubToken, resolveToken } from "./token.js";

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

describe("githubToken", () => {
  const original = { ...process.env };
  const made: string[] = [];
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });
  afterEach(async () => {
    process.env = { ...original };
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });

  it("takes an explicit token, then the environment, before the App", async () => {
    expect(await githubToken(".", "explicit")).toEqual({
      token: "explicit",
      source: "explicit",
    });
    process.env.GH_TOKEN = "from-env";
    expect(await githubToken(".")).toEqual({
      token: "from-env",
      source: "env",
    });
  });

  it("acts as the factory's App when it's installed on the repo", async () => {
    const config = await mkdtemp(join(tmpdir(), "factory-app-"));
    const repo = await mkdtemp(join(tmpdir(), "factory-repo-"));
    made.push(config, repo);
    process.env.FACTORY_CONFIG_DIR = config;
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", [
      "-C",
      repo,
      "remote",
      "add",
      "origin",
      "https://github.com/arynbht/demo.git",
    ]);
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    await saveApp({
      id: 1,
      slug: "factory",
      client_id: "Iv1.x",
      client_secret: "s",
      webhook_secret: null,
      pem: privateKey,
      html_url: "https://github.com/apps/factory",
    });
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return url.endsWith("/installation")
        ? Response.json({ id: 9 })
        : Response.json({
            token: "ghs_app",
            expires_at: "2026-11-13T01:00:00Z",
          });
    }) as typeof fetch;
    expect(await githubToken(repo, undefined, { fetch: fake })).toEqual({
      token: "ghs_app",
      source: "app",
    });
    expect(seen[0]).toBe(
      "https://api.github.com/repos/arynbht/demo/installation",
    );
  });
});
