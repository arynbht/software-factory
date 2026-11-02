import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runAuditAll } from "./multi.js";

describe("runAuditAll", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });
  async function tmp(prefix: string): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), prefix));
    made.push(d);
    return d;
  }

  it("audits every repo in the list and prints a combined table", async () => {
    const repoA = await tmp("factory-multi-a-");
    const repoB = await tmp("factory-multi-b-");
    const listDir = await tmp("factory-multi-list-");
    const listFile = join(listDir, "repos.yml");
    await writeFile(listFile, `- ${repoA}\n- ${repoB}\n`);

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });

    const code = await runAuditAll({ repos: listFile }, { token: null });
    expect(code).toBe(0); // empty repos have no critical fails
    const text = out.join("");
    expect(text).toContain(repoA);
    expect(text).toContain(repoB);
    expect(text).toMatch(/pass\s+fail\s+need-ev\s+total/);
  });

  it("--json returns a row per repo, marking a missing one as an error", async () => {
    const repoA = await tmp("factory-multi-a-");
    const listDir = await tmp("factory-multi-list-");
    const listFile = join(listDir, "repos.yml");
    await writeFile(listFile, `- ${repoA}\n- /definitely/missing/repo\n`);

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });

    await runAuditAll({ repos: listFile, json: true }, { token: null });
    const rows = JSON.parse(out.join(""));
    expect(rows).toHaveLength(2);
    expect(rows[0].ok).toBe(true);
    expect(rows[1].ok).toBe(false);
  });

  it("errors when the repo list file is missing", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runAuditAll(
      { repos: join(tmpdir(), "factory-no-such-list.yml") },
      { token: null },
    );
    expect(code).toBe(1);
  });
});
