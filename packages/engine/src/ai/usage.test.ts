import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendUsage,
  estimateCost,
  loadUsage,
  summarizeUsage,
  type UsageEntry,
} from "./usage.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-usage-"));
  made.push(dir);
  await mkdir(join(dir, ".factory"), { recursive: true });
  return dir;
}

const entry = (over: Partial<UsageEntry>): UsageEntry => ({
  date: "2026-11-01",
  task: "explain-gaps",
  model: "claude-sonnet-4-6",
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.001,
  ...over,
});

describe("estimateCost", () => {
  it("prices known models by input/output tokens", () => {
    // sonnet: $3/M in, $15/M out → 1M in + 1M out = $18
    expect(
      estimateCost("claude-sonnet-4-6", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(18, 5);
  });

  it("prices opus 4.8 at $5/M in, $25/M out", () => {
    // opus 4.8: 1M in + 1M out = $30 (not the $90 of the old 15/75 table)
    expect(
      estimateCost("claude-opus-4-8", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(30, 5);
  });

  it("returns 0 for an unpriced model", () => {
    expect(
      estimateCost("some-future-model", { inputTokens: 100, outputTokens: 50 }),
    ).toBe(0);
  });
});

describe("usage log", () => {
  it("appends and reads back entries (JSONL)", async () => {
    const dir = await repo();
    await appendUsage(dir, entry({ task: "a" }));
    await appendUsage(dir, entry({ task: "b" }));
    const entries = await loadUsage(dir);
    expect(entries.map((e) => e.task)).toEqual(["a", "b"]);
  });

  it("returns an empty history when there is no log", async () => {
    const dir = await repo();
    expect(await loadUsage(dir)).toEqual([]);
  });

  it("skips a corrupt line rather than failing", async () => {
    const dir = await repo();
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, ".factory", "ai-usage.log"), "not json\n");
    await appendUsage(dir, entry({ task: "ok" }));
    const entries = await loadUsage(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.task).toBe("ok");
  });

  it("summarizes totals and per-task / per-day breakdowns", () => {
    const s = summarizeUsage([
      entry({ task: "a", date: "2026-11-01", costUsd: 1 }),
      entry({ task: "a", date: "2026-11-02", costUsd: 2 }),
      entry({ task: "b", date: "2026-11-02", costUsd: 3 }),
    ]);
    expect(s.calls).toBe(3);
    expect(s.costUsd).toBeCloseTo(6, 5);
    expect(s.byTask["a"]).toEqual({ calls: 2, costUsd: 3 });
    expect(s.byTask["b"]).toEqual({ calls: 1, costUsd: 3 });
    expect(s.byDay["2026-11-02"]).toEqual({ calls: 2, costUsd: 5 });
  });
});
