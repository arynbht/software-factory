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
    expect(out.join("")).toMatch(/\(40 controls\)/);

    const state = JSON.parse(
      await readFile(join(dir, ".factory", "state.json"), "utf8"),
    );
    expect(state.summary.total).toBe(40);
    expect(state.controls).toHaveLength(40);
    expect(state.version).toBe(1);
  });

  it("filters by lane", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAudit(dir, { lane: "testing" }, { token: null });

    const state = JSON.parse(
      await readFile(join(dir, ".factory", "state.json"), "utf8"),
    );
    expect(state.summary.total).toBe(4); // the 4 testing controls
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
});
