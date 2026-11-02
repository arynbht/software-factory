import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { OpenPrParams, PrResult } from "@arynbht/factory-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runFix } from "./fix.js";

const git = promisify(execFile);
const GIT = (cwd: string, ...args: string[]) => git("git", args, { cwd });

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** A git repo on `main` with a bare `origin` remote and a clean tree. */
async function gitRepoWithRemote(made: string[]): Promise<string> {
  const bare = await mkdtemp(join(tmpdir(), "factory-fix-remote-"));
  made.push(bare);
  await GIT(bare, "init", "--bare");

  const work = await mkdtemp(join(tmpdir(), "factory-fix-work-"));
  made.push(work);
  await GIT(work, "init");
  await GIT(work, "config", "user.email", "t@e.com");
  await GIT(work, "config", "user.name", "t");
  await GIT(work, "config", "commit.gpgsign", "false");
  await GIT(work, "remote", "add", "origin", bare);
  await GIT(work, "commit", "--allow-empty", "-m", "seed");
  await GIT(work, "branch", "-M", "main");
  return work;
}

const fakePr =
  (sink: OpenPrParams[], reused = false) =>
  async (params: OpenPrParams): Promise<PrResult> => {
    sink.push(params);
    return { number: 11, url: "https://github.com/o/r/pull/11", reused };
  };

describe("runFix (integration)", () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });

  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "factory-fix-"));
    made.push(dir);
    return dir;
  }

  it("dry-run previews file creates without touching disk", async () => {
    const dir = await tempRepo();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });

    const code = await runFix(dir, { gate: "scaffold" }, { token: null });

    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toMatch(/create/);
    expect(text).toMatch(/--write/);
    // Nothing should have been written in dry-run mode.
    expect(await exists(join(dir, "README.md"))).toBe(false);
  });

  it("--write materialises files on disk", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runFix(
      dir,
      { gate: "scaffold", write: true },
      { token: null },
    );

    expect(code).toBe(0);
    expect(await exists(join(dir, "README.md"))).toBe(true);
  });

  it("running twice is idempotent (second run makes no file changes)", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runFix(dir, { gate: "scaffold", write: true }, { token: null });

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const code = await runFix(
      dir,
      { gate: "scaffold", write: true },
      { token: null },
    );

    expect(code).toBe(0);
    expect(out.join("")).toMatch(/0 file changes/);
  });

  it("errors on an unknown control", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runFix(
      dir,
      { control: "nope.not-real" },
      { token: null },
    );
    expect(code).toBe(1);
  });

  it("errors on an unknown gate", async () => {
    const dir = await tempRepo();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runFix(dir, { gate: "nope" }, { token: null });
    expect(code).toBe(1);
  });

  it("fails fast on a nonexistent path", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runFix(
      join(tmpdir(), "factory-fix-definitely-missing-xyz"),
      {},
      { token: null },
    );
    expect(code).toBe(1);
  });

  describe("--pr", () => {
    it("opens a PR and reports it", async () => {
      const work = await gitRepoWithRemote(made);
      const out: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        out.push(String(chunk));
        return true;
      });
      const calls: OpenPrParams[] = [];

      const code = await runFix(
        work,
        { gate: "scaffold", pr: true },
        { token: null, today: "2026-11-01", openPr: fakePr(calls) },
      );

      expect(code).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        head: "factory/2026-11-01-scaffold",
        base: "main",
      });
      expect(out.join("")).toContain("Opened PR #11");
    });

    it("maps a FixPrError to exit 1 (dirty working tree)", async () => {
      const work = await gitRepoWithRemote(made);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(work, "dirty.txt"), "uncommitted");
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const code = await runFix(
        work,
        { gate: "scaffold", pr: true },
        { token: null, today: "2026-11-01", openPr: fakePr([]) },
      );
      expect(code).toBe(1);
    });

    it("exits 1 when no token/slug is available to open a PR", async () => {
      const work = await gitRepoWithRemote(made);
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      // No openPr seam and token:null → defaultOpenPr finds no GitHub client.
      const code = await runFix(
        work,
        { gate: "scaffold", pr: true },
        { token: null, today: "2026-11-01" },
      );
      expect(code).toBe(1);
    });
  });
});
