import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { applyChanges } from "./apply.js";
import { githubSettingGenerator } from "./github-setting.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const REPO = "https://api.github.com/repos/o/r";
const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "factory-ghset-"));
  made.push(d);
  return d;
}

const control = (setting: string): Control =>
  ({
    id: "sec.x",
    title: "t",
    lane: "security",
    phase: "harden",
    severity: "medium",
    detect: [{ type: "github-api", check: "dependabot-security-updates" }],
    evidence: "none",
    references: [{ name: "r", url: "https://e.com" }],
    rationale: "r",
    fix: { type: "github-setting", setting },
  }) as Control;

const ctx = (dir: string) =>
  buildContext(dir, { token: "t", github: { owner: "o", repo: "r" } });

describe("githubSettingGenerator", () => {
  it("returns an effect and makes no API call in dry-run", async () => {
    const dir = await tmp();
    const changes = await githubSettingGenerator(
      ctx(dir),
      control("dependabot-security-updates"),
    );
    expect(changes[0]?.type).toBe("effect");
    // onUnhandledRequest: "error" would throw if dry-run hit the network.
    const [r] = await applyChanges(dir, changes, { mode: "dry-run" });
    expect(r?.action).toBe("effect");
    expect(r?.error).toBeUndefined();
  });

  it("enables Dependabot security updates in write mode", async () => {
    const dir = await tmp();
    let called = false;
    server.use(
      http.put(`${REPO}/automated-security-fixes`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const changes = await githubSettingGenerator(
      ctx(dir),
      control("dependabot-security-updates"),
    );
    const [r] = await applyChanges(dir, changes, { mode: "write" });
    expect(called).toBe(true);
    expect(r?.error).toBeUndefined();
  });

  it("creates the protection ruleset only when absent", async () => {
    const dir = await tmp();
    let posted = 0;
    server.use(
      http.get(`${REPO}/rulesets`, () =>
        HttpResponse.json([{ name: "factory: protect default branch" }]),
      ),
      http.post(`${REPO}/rulesets`, () => {
        posted += 1;
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    await applyChanges(
      dir,
      await githubSettingGenerator(ctx(dir), control("branch-protection")),
      { mode: "write" },
    );
    expect(posted).toBe(0); // already exists → no create
  });

  it("records a failure instead of aborting when the API denies the change", async () => {
    const dir = await tmp();
    server.use(
      http.put(`${REPO}/automated-security-fixes`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );
    const [r] = await applyChanges(
      dir,
      await githubSettingGenerator(
        ctx(dir),
        control("dependabot-security-updates"),
      ),
      { mode: "write" },
    );
    expect(r?.error).toBeDefined();
    expect(r?.message).toMatch(/failed/i);
  });
});
