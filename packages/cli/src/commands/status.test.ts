import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runStatus } from "./status.js";

describe("runStatus", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });
  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "factory-status-"));
    made.push(d);
    return d;
  }

  it("infers scaffold on an empty repo and lists blockers", async () => {
    const dir = await tmp();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });

    const code = await runStatus(dir, {}, { token: null });

    expect(code).toBe(0);
    const text = out.join("");
    // An empty repo fails scaffold-phase controls → scaffold is the first non-green gate.
    expect(text).toMatch(/Inferred phase:\s+scaffold/);
    expect(text).toMatch(/Blocking/);
  });

  it("--json returns a structured report sorted by severity", async () => {
    const dir = await tmp();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });

    const code = await runStatus(dir, { json: true }, { token: null });
    expect(code).toBe(0);
    const report = JSON.parse(out.join(""));
    expect(report.inferredPhase).toBe("scaffold");
    expect(Array.isArray(report.gates)).toBe(true);
    expect(report.blockers.length).toBeGreaterThan(0);
    // Each blocker carries severity + effort for prioritization.
    expect(report.blockers[0]).toHaveProperty("severity");
    expect(report.blockers[0]).toHaveProperty("effort");
  });

  it("fails fast on a nonexistent path", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runStatus(
      join(tmpdir(), "factory-status-missing-xyz"),
      {},
      { token: null },
    );
    expect(code).toBe(1);
  });
});
