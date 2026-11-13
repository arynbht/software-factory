import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runTaskConfirm,
  runTaskNew,
  runTaskRelease,
  runTaskResume,
  runTaskStatus,
} from "./task.js";

const made: string[] = [];
const savedConfig = process.env.FACTORY_CONFIG_DIR;
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let out: string[];
let err: string[];
beforeEach(async () => {
  // One ledger key for both "machines": the App holds the shared key later (§8).
  process.env.FACTORY_CONFIG_DIR = await tmp("factory-config-");
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out.push(String(s));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation((s: unknown) => {
    err.push(String(s));
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (savedConfig === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = savedConfig;
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

/** An origin with a factory profile, and two people's clones of it. */
async function team(): Promise<{ ann: string; bob: string }> {
  const origin = await tmp("factory-origin-");
  git(origin, "init", "--bare", "-b", "main");
  const seed = await tmp("factory-seed-");
  git(seed, "init", "-b", "main");
  execFileSync("git", ["-C", seed, "commit", "--allow-empty", "-m", "base"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  git(seed, "push", "-q", origin, "main");
  const clone = async (email: string) => {
    const dir = await tmp("factory-clone-");
    git(dir, "clone", "-q", origin, ".");
    git(dir, "config", "user.email", email);
    await writeFile(join(dir, ".gitignore"), ".factory/tasks/\n");
    return dir;
  };
  return { ann: await clone("ann@team"), bob: await clone("bob@team") };
}

const draft = (path: string) =>
  runTaskNew("Fix the login redirect", {
    type: "fix",
    description: "After login the app lands on a blank page.",
    accept: ["Redirects to /home after login::e2e"],
    path,
  });

describe("factory task, shared through the factory/tasks branch", () => {
  it("drafts on one machine, and the other sees it but can't take it while it's held", async () => {
    const { ann, bob } = await team();
    expect(await draft(ann), err.join(" | ")).toBe(0);
    expect(out.join("")).toContain("drafted T-0001");

    out = [];
    expect(await runTaskStatus({ path: bob })).toBe(0);
    expect(out.join("")).toMatch(/T-0001\s+draft\s+Fix the login redirect/);

    // Bob's own draft gets the next id, not a second T-0001.
    out = [];
    expect(await draft(bob), err.join(" | ")).toBe(0);
    expect(out.join("")).toContain("drafted T-0002");

    // Ann holds T-0001: Bob is refused before anything is recorded.
    expect(await runTaskConfirm("T-0001", { yes: true, path: bob })).toBe(1);
    expect(err.join("\n")).toMatch(/T-0001 is held by ann@team on /);

    // Once Ann releases it, Bob takes it over and carries on.
    expect(await runTaskRelease("T-0001", { path: ann })).toBe(0);
    expect(await runTaskConfirm("T-0001", { yes: true, path: bob })).toBe(0);
    out = [];
    expect(await runTaskResume("T-0001", { path: ann })).toBe(0);
    expect(out.join("")).toMatch(/intake confirmed.*\(bob@team \(--yes\)\)/);
    expect(out.join("")).toMatch(/held by bob@team on .* until/);
  }, 60_000);

  it("refuses a card with no verify before reserving an id", async () => {
    const { ann } = await team();
    expect(
      await runTaskNew("No verify", {
        type: "fix",
        description: "d",
        accept: ["works"],
        path: ann,
      }),
    ).toBe(1);
    expect(err.join(" | ")).toMatch(/verify/);
    expect(git(ann, "branch", "--list", "factory/tasks")).toBe("");
  }, 60_000);
});
