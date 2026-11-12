import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runInit } from "./init.js";
import { GUARD_COMMAND, SESSION_START_COMMAND } from "./init-files.js";

// Each init runs a full audit, and some run it more than once: slower on Windows CI.
describe("runInit (integration)", { timeout: 30_000 }, () => {
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
      SESSION_START_COMMAND,
    );
    expect(settings.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe(
      GUARD_COMMAND,
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

  it("merges its hooks into an existing settings.json, keeping everything else", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const theirs = {
      permissions: { allow: ["Bash(npm test)"] },
      hooks: {
        PreToolUse: [
          // Theirs, kept as it is.
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "./audit.sh" }],
          },
          // An earlier init's guard: replaced, not duplicated.
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: "factory hook guard" }],
          },
        ],
      },
    };
    const original = `${JSON.stringify(theirs, null, 2)}\n`;
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.json"), original);
    expect(
      await runInit(dir, { type: "cli", yes: true }, { token: null }),
    ).toBe(0);

    const read = (...p: string[]) => readFile(join(dir, ...p), "utf8");
    const merged = JSON.parse(await read(".claude", "settings.json")) as {
      permissions: unknown;
      hooks: Record<
        string,
        { matcher?: string; hooks: { command: string }[] }[]
      >;
    };
    expect(merged.permissions).toEqual(theirs.permissions);
    expect(
      merged.hooks.PreToolUse?.map((g) => [g.matcher, g.hooks[0]?.command]),
    ).toEqual([
      ["Bash", "./audit.sh"],
      ["Edit|Write|MultiEdit|NotebookEdit|Bash", GUARD_COMMAND],
    ]);
    expect(merged.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      SESSION_START_COMMAND,
    );
    expect(await read(".claude", "settings.json.bak")).toBe(original);
    await expect(
      access(join(dir, ".claude", "settings.factory.json")),
    ).rejects.toThrow();

    // A re-run converges: nothing to merge, so no second backup.
    await runInit(
      dir,
      { type: "cli", yes: true, force: true },
      { token: null },
    );
    await expect(
      access(join(dir, ".claude", "settings.json.bak.1")),
    ).rejects.toThrow();
  });

  it("puts its hooks beside a settings.json it can't parse, and says the guard is off", async () => {
    const dir = await tmp();
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.json"), "{ // comments\n}");
    await runInit(dir, { type: "cli", yes: true }, { token: null });
    expect(await readFile(join(dir, ".claude", "settings.json"), "utf8")).toBe(
      "{ // comments\n}",
    );
    await expect(
      access(join(dir, ".claude", "settings.factory.json")),
    ).resolves.toBeUndefined();
    expect(out.mock.calls.join("")).toMatch(/the guard is off/);
  });

  it("--force backs up what it replaces, and never resets waivers or evidence", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runInit(dir, { type: "cli", yes: true }, { token: null });
    const read = (...p: string[]) => readFile(join(dir, ...p), "utf8");
    const waiver =
      "- control: docs.runbooks-dir\n  reason: not yet\n  expires: 2027-01-01\n  owner: '@me'\n";
    await writeFile(join(dir, ".factory", "waivers.yml"), waiver);
    await writeFile(join(dir, ".factory", "evidence.yml"), "- note: kept\n");
    const profile = await read(".factory", "profile.yml");
    const workflow = await read(".github", "workflows", "factory.yml");

    await runInit(
      dir,
      { type: "library", phase: "build", yes: true, force: true },
      { token: null },
    );
    expect(await read(".factory", "waivers.yml")).toBe(waiver);
    expect(await read(".factory", "evidence.yml")).toBe("- note: kept\n");
    expect(await read(".factory", "profile.yml")).toContain("type: library");
    expect(await read(".factory", "profile.yml.bak")).toBe(profile);
    expect(await read(".github", "workflows", "factory.yml")).toContain(
      "gate: build",
    );
    expect(await read(".github", "workflows", "factory.yml.bak")).toBe(
      workflow,
    );
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
