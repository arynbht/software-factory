import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type AiClient,
  type OpenPrParams,
  type PrResult,
} from "@arynbht/factory-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAi, runAiUsage } from "./ai.js";

const git = promisify(execFile);
const GIT = (cwd: string, ...args: string[]) => git("git", args, { cwd });

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
  vi.restoreAllMocks();
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "factory-ai-"));
  made.push(d);
  return d;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// A client that returns a fixed response — no network.
const recorded: AiClient = {
  complete: async () => ({
    text: "## Security\nNo SAST yet; add CodeQL.\n",
    usage: { inputTokens: 200, outputTokens: 80 },
    model: "claude-sonnet-4-6",
  }),
};

describe("runAi", () => {
  it("dry-run previews the generated file without writing it", async () => {
    const dir = await tmp();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });

    const code = await runAi(
      "explain-gaps",
      dir,
      {},
      { client: recorded, today: "2026-11-01", token: null },
    );

    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toMatch(/explain-gaps|create|docs\/factory-gaps\.md/);
    expect(text).toContain("200 in / 80 out");
    expect(await exists(join(dir, "docs", "factory-gaps.md"))).toBe(false);
  });

  it("--write materialises the generated file", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runAi(
      "explain-gaps",
      dir,
      { write: true },
      { client: recorded, today: "2026-11-01", token: null },
    );

    expect(code).toBe(0);
    expect(await exists(join(dir, "docs", "factory-gaps.md"))).toBe(true);
  });

  it("errors clearly on an unknown task", async () => {
    const dir = await tmp();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m) => {
      errs.push(String(m));
    });

    const code = await runAi(
      "no-such-task",
      dir,
      {},
      { client: recorded, today: "2026-11-01", token: null },
    );
    expect(code).toBe(1);
    expect(errs.join("")).toMatch(/unknown task/);
  });

  it("records usage and `ai usage` summarizes it", async () => {
    const dir = await tmp();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".factory"), { recursive: true });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAi(
      "explain-gaps",
      dir,
      { write: true },
      { client: recorded, today: "2026-11-01", token: null },
    );
    expect(await exists(join(dir, ".factory", "ai-usage.log"))).toBe(true);

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    const code = await runAiUsage(dir);
    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toMatch(/AI usage — 1 call/);
    expect(text).toContain("explain-gaps");
  });

  it("`ai usage` reports nothing when there's no log", async () => {
    const dir = await tmp();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    expect(await runAiUsage(dir)).toBe(0);
    expect(out.join("")).toMatch(/No AI usage recorded/);
  });

  it("opens a PR for the generated artifact", async () => {
    // A git repo with a bare origin so the push target exists.
    const bare = await tmp();
    await GIT(bare, "init", "--bare");
    const work = await tmp();
    await GIT(work, "init");
    await GIT(work, "config", "user.email", "t@e.com");
    await GIT(work, "config", "user.name", "t");
    await GIT(work, "config", "commit.gpgsign", "false");
    await GIT(work, "remote", "add", "origin", bare);
    await GIT(work, "commit", "--allow-empty", "-m", "seed");
    await GIT(work, "branch", "-M", "main");

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    const calls: OpenPrParams[] = [];
    const openPr = async (p: OpenPrParams): Promise<PrResult> => {
      calls.push(p);
      return { number: 7, url: "https://github.com/o/r/pull/7", reused: false };
    };

    const code = await runAi(
      "explain-gaps",
      work,
      { pr: true },
      { client: recorded, today: "2026-11-01", token: null, openPr },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(out.join("")).toContain("Opened PR #7");
  }, 30_000);
});
