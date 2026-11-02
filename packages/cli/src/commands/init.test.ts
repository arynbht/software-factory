import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runInit } from "./init.js";

describe("runInit (integration)", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-init-"));
    made.push(d);
    return d;
  };

  it("writes config + workflow and runs the first audit", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runInit(
      dir,
      {
        type: "cli",
        name: "demo",
        phase: "scaffold",
        flag: ["open-source"],
        yes: true,
      },
      { token: null },
    );

    expect(code).toBe(0);
    const profile = await readFile(
      join(dir, ".factory", "profile.yml"),
      "utf8",
    );
    expect(profile).toContain("type: cli");
    expect(profile).toContain("open-source: true");
    await expect(
      access(join(dir, ".factory", "waivers.yml")),
    ).resolves.toBeUndefined();
    const workflow = await readFile(
      join(dir, ".github", "workflows", "factory.yml"),
      "utf8",
    );
    expect(workflow).toContain("name: factory");
    expect(workflow).toContain("cron:");
    expect(workflow).toContain("gate: scaffold");

    // The Claude Code skill is installed so an agent here knows to run the audit.
    const skill = await readFile(
      join(dir, ".claude", "skills", "factory", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: factory");
    expect(skill).toContain("factory audit");
  });

  it("refuses to overwrite an existing config without --force", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runInit(dir, { type: "cli", yes: true }, { token: null });
    const code = await runInit(
      dir,
      { type: "library", yes: true },
      { token: null },
    );
    expect(code).toBe(1);
  });

  it("requires --type in non-interactive mode", async () => {
    const dir = await tmp();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runInit(dir, { yes: true }, { token: null });
    expect(code).toBe(1);
  });
});
