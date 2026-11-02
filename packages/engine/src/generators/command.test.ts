import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { applyChanges } from "./apply.js";
import { commandGenerator } from "./command.js";

const control = (run: string): Control =>
  ({
    id: "repo.lockfile.present",
    title: "t",
    lane: "hygiene",
    phase: "scaffold",
    severity: "medium",
    detect: [{ type: "file-exists", path: "x" }],
    evidence: "none",
    references: [{ name: "r", url: "https://e.com" }],
    rationale: "r",
    fix: { type: "command", run },
  }) as Control;

describe("commandGenerator", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-cmdgen-"));
    made.push(d);
    return d;
  };

  it("emits an effect with the command, and dry-run does not run it", async () => {
    const dir = await tmp();
    const changes = await commandGenerator(
      buildContext(dir),
      control("node -e process.exit(1)"),
    );
    expect(changes[0]).toMatchObject({
      type: "effect",
      summary: "run: node -e process.exit(1)",
    });
    const [r] = await applyChanges(dir, changes, { mode: "dry-run" });
    expect(r?.error).toBeUndefined(); // not executed
  });

  it("runs the command on write and succeeds on exit 0", async () => {
    const dir = await tmp();
    const [r] = await applyChanges(
      dir,
      await commandGenerator(
        buildContext(dir),
        control("node -e process.exit(0)"),
      ),
      { mode: "write" },
    );
    expect(r?.error).toBeUndefined();
  });

  it("records a failure on a non-zero exit", async () => {
    const dir = await tmp();
    const [r] = await applyChanges(
      dir,
      await commandGenerator(
        buildContext(dir),
        control("node -e process.exit(2)"),
      ),
      { mode: "write" },
    );
    expect(r?.error).toBeDefined();
  });

  it("records a failure when the tool is not installed", async () => {
    const dir = await tmp();
    const [r] = await applyChanges(
      dir,
      await commandGenerator(
        buildContext(dir),
        control("definitely-not-a-tool-xyz"),
      ),
      { mode: "write" },
    );
    expect(r?.error).toMatch(/not installed/i);
  });
});
