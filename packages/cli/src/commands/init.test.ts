import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

    // §10: the /factory skill, the contract, its hooks and the PR template.
    const read = (...p: string[]) => readFile(join(dir, ...p), "utf8");
    const skill = await read(".claude", "skills", "factory", "SKILL.md");
    expect(skill).toContain("name: factory");
    expect(skill).toContain("factory task run <id>");
    const agents = await read("AGENTS.md");
    expect(agents).toContain("Run `factory doctor`");
    expect(agents).toContain("## Stop and ask");
    expect(agents).toContain("- `.factory/**`");
    expect(agents).toContain("- **demo**: cli, phase scaffold");
    expect(await read("CLAUDE.md")).toContain("@AGENTS.md");
    expect(await read("CONSTRAINTS.md")).toContain("No new dependency");
    expect(await read(".github", "PULL_REQUEST_TEMPLATE.md")).toContain(
      "## Proof",
    );
    const settings = JSON.parse(await read(".claude", "settings.json")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(settings.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      "factory hook session-start",
    );
    expect(settings.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe(
      "factory hook guard",
    );
    expect(await read(".factory", ".gitignore")).toBe(
      "tasks/\nai-usage.log\ncache/\n",
    );
    // The spine skills are locked; task-scope skills aren't.
    const lock = await read(".factory", "skills.lock");
    expect(lock).toContain("scope: always");
    expect(lock).not.toContain("scope: task");
  });

  it("never overwrites a file the repo already has: the factory's version goes beside it", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeFile(join(dir, "AGENTS.md"), "# Our own rules\n");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }),
    );
    await writeFile(join(dir, "package-lock.json"), "{}");
    expect(
      await runInit(dir, { type: "cli", yes: true }, { token: null }),
    ).toBe(0);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe(
      "# Our own rules\n",
    );
    const ours = await readFile(join(dir, "AGENTS.factory.md"), "utf8");
    expect(ours).toMatch(
      /Commands: install `npm install` · lint `npm run lint` · test `npm run test`/,
    );
    expect(await readFile(join(dir, "CONSTRAINTS.md"), "utf8")).toContain(
      "`npm run lint`, `npm run test` pass",
    );

    // --force replaces it, and keeps the person's version as a backup, never
    // over a backup that's already there.
    await writeFile(join(dir, "AGENTS.md.bak"), "# my notes\n");
    expect(
      await runInit(
        dir,
        { type: "cli", yes: true, force: true },
        { token: null },
      ),
    ).toBe(0);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe(ours);
    expect(await readFile(join(dir, "AGENTS.md.bak"), "utf8")).toBe(
      "# my notes\n",
    );
    expect(await readFile(join(dir, "AGENTS.md.bak.1"), "utf8")).toBe(
      "# Our own rules\n",
    );
    // A second --force after the generated file changes keeps every version.
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc" } }),
    );
    await runInit(
      dir,
      { type: "cli", yes: true, force: true },
      { token: null },
    );
    expect(await readFile(join(dir, "AGENTS.md.bak.1"), "utf8")).toBe(
      "# Our own rules\n",
    );
    expect(await readFile(join(dir, "AGENTS.md.bak.2"), "utf8")).toBe(ours);
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
