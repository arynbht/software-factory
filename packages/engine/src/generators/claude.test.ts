import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { type AiTransport } from "../ai/client.js";
import { buildContext } from "../context.js";
import { claudeGenerator } from "./claude.js";
import { generators } from "./registry.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

const transport: AiTransport = {
  create: async () => ({
    text: "## Threats\nSpoofing: ...",
    usage: { inputTokens: 10, outputTokens: 20 },
    model: "claude-sonnet-4-6",
  }),
};

describe("claude generator", () => {
  it("is registered for the claude fix type", () => {
    expect(generators.claude).toBe(claudeGenerator);
  });

  it("generates a file from the control's task via the context AI client", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-claude-"));
    made.push(dir);
    const ctx = buildContext(dir, {
      now: new Date("2026-11-01T00:00:00Z"),
      ai: { transport },
    });
    const control = {
      id: "sec.threat-model",
      fix: { type: "claude", task: "explain-gaps" }, // a bundled prompt
    } as Control;

    const changes = await claudeGenerator(ctx, control);
    expect(changes).toHaveLength(1);
    const change = changes[0]!;
    expect(change).toMatchObject({
      type: "file",
      path: "docs/factory-gaps.md",
      op: "create",
      controlId: "sec.threat-model",
    });
    const contents = change.type === "file" ? change.contents : "";
    expect(contents).toContain("date: 2026-11-01");
    expect(contents).toContain("Spoofing");
  });

  it("makes no change (and no AI call) when the draft already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-claude-"));
    made.push(dir);
    let calls = 0;
    const counting: AiTransport = {
      create: async () => {
        calls++;
        return {
          text: "x",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "claude-sonnet-4-6",
        };
      },
    };
    const ctx = buildContext(dir, {
      now: new Date("2026-11-01T00:00:00Z"),
      ai: { transport: counting },
    });
    const control = {
      id: "sec.threat-model",
      fix: { type: "claude", task: "explain-gaps" },
    } as Control;

    // First run generates the draft.
    expect(await claudeGenerator(ctx, control)).toHaveLength(1);
    expect(calls).toBe(1);

    // Write the draft to disk, then a second run is a no-op with no API call.
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "factory-gaps.md"), "already drafted\n");
    expect(await claudeGenerator(ctx, control)).toEqual([]);
    expect(calls).toBe(1);
  });

  it("returns nothing for a non-claude fix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-claude-"));
    made.push(dir);
    const ctx = buildContext(dir, { ai: { transport } });
    const control = {
      id: "repo.readme.present",
      fix: { type: "template", template: "readme" },
    } as Control;
    expect(await claudeGenerator(ctx, control)).toEqual([]);
  });

  it("degrades to no change when no API key is available (fix must not abort)", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const dir = await mkdtemp(join(tmpdir(), "factory-claude-"));
      made.push(dir);
      // No transport and no key → the real transport raises AiKeyError.
      const ctx = buildContext(dir, { ai: { maxRetries: 0 } });
      const control = {
        id: "sec.threat-model",
        fix: { type: "claude", task: "threat-model" },
      } as Control;
      expect(await claudeGenerator(ctx, control)).toEqual([]);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
