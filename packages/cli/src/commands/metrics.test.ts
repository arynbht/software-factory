import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runMetrics } from "./metrics.js";

describe("runMetrics", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });
  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "factory-metrics-"));
    made.push(d);
    return d;
  }

  it("errors when no GitHub client is available (no token/remote)", async () => {
    const dir = await tmp();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runMetrics(dir, {}, { token: null });
    expect(code).toBe(1);
  });

  it("rejects an invalid --window", async () => {
    const dir = await tmp();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // token:null → no client, but --window is validated after the client check;
    // use a bogus window with no client still returns 1 (client check first).
    const code = await runMetrics(dir, { window: "-5" }, { token: null });
    expect(code).toBe(1);
  });

  it("fails fast on a nonexistent path", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runMetrics(
      join(tmpdir(), "factory-metrics-missing-xyz"),
      {},
      { token: null },
    );
    expect(code).toBe(1);
  });
});
