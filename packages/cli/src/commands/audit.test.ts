import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runAudit } from "./audit.js";

describe("runAudit (integration)", () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });

  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "factory-audit-"));
    made.push(dir);
    return dir;
  }

  it("audits a repo end-to-end, prints a report, writes state.json, exits 0", async () => {
    const dir = await tempRepo();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });

    // token: null forces offline so github-api checks skip (no network in tests).
    const code = await runAudit(dir, {}, { token: null });

    expect(code).toBe(0); // no critical control, so always 0
    expect(out.join("")).toMatch(/\(\d+ controls\)/);

    const state = JSON.parse(
      await readFile(join(dir, ".factory", "state.json"), "utf8"),
    );
    // Don't hard-code the catalog size — just assert it ran a reasonable number.
    expect(state.summary.total).toBeGreaterThanOrEqual(30);
    expect(state.controls).toHaveLength(state.summary.total);
    expect(state.version).toBe(1);
  });

  it("filters by lane", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAudit(dir, { lane: "testing" }, { token: null });

    const state = JSON.parse(
      await readFile(join(dir, ".factory", "state.json"), "utf8"),
    );
    expect(state.summary.total).toBeGreaterThan(0);
    expect(
      state.controls.every((c: { lane: string }) => c.lane === "testing"),
    ).toBe(true);
  });

  it("fails fast on a nonexistent path", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runAudit(
      join(tmpdir(), "factory-definitely-missing-xyz"),
      {},
      { token: null },
    );
    expect(code).toBe(1);
  });

  it("exits 1 when a requested gate is red", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // An empty repo fails scaffold-phase controls, so the scaffold gate is red.
    const code = await runAudit(dir, { gate: "scaffold" }, { token: null });
    expect(code).toBe(1);
  });

  it("keeps stdout valid JSON when --json is combined with --gate", async () => {
    const dir = await tempRepo();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runAudit(
      dir,
      { json: true, gate: "all" },
      { token: null },
    );

    // Red gate on an empty repo → exit 1, but stdout must still parse as JSON.
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join(""));
    expect(Array.isArray(parsed.controls)).toBe(true);
    expect(Array.isArray(parsed.gates)).toBe(true);
    expect(parsed.gates[0]).toHaveProperty("status");
  });

  it("errors when --json and a conflicting --format are both given", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runAudit(
      tmpdir(),
      { json: true, format: "markdown" },
      { token: null },
    );
    expect(code).toBe(1);
  });

  it("errors on an unknown gate", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runAudit(dir, { gate: "nope" }, { token: null });
    expect(code).toBe(1);
  });
});
