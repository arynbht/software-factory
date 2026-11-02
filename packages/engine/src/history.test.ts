import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ControlResult } from "./evaluate.js";
import { appendHistory, laneCounts, loadHistory } from "./history.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-hist-"));
  made.push(dir);
  await mkdir(join(dir, ".factory"), { recursive: true });
  return dir;
}

const result = (lane: string, status: ControlResult["status"]): ControlResult =>
  ({ controlId: `${lane}.x`, lane, status }) as ControlResult;

describe("laneCounts", () => {
  it("counts pass/total per lane, excludes n/a, counts waived as pass", () => {
    const counts = laneCounts([
      result("security", "pass"),
      result("security", "fail"),
      result("security", "waived"),
      result("testing", "pass"),
      result("testing", "n/a"), // excluded
    ]);
    expect(counts["security"]).toEqual({ pass: 2, total: 3 });
    expect(counts["testing"]).toEqual({ pass: 1, total: 1 });
  });
});

describe("history log", () => {
  it("appends and reads back snapshots", async () => {
    const dir = await repo();
    await appendHistory(dir, {
      date: "2026-10-25",
      byLane: { security: { pass: 5, total: 10 } },
    });
    await appendHistory(dir, {
      date: "2026-11-01",
      byLane: { security: { pass: 7, total: 10 } },
    });
    const entries = await loadHistory(dir);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.byLane["security"]).toEqual({ pass: 7, total: 10 });
  });

  it("returns an empty history when there is no file", async () => {
    expect(await loadHistory(await repo())).toEqual([]);
  });
});
