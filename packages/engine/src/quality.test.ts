import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "./context.js";
import { runDetector } from "./detectors/run.js";
import { ratchetCoverageBaseline, readQualityFile } from "./quality.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});
const repoWith = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "factory-quality-"));
  made.push(dir);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), contents, "utf8");
  }
  return dir;
};
const summary = (pct: number) => JSON.stringify({ total: { lines: { pct } } });
const CONFIGURED = {
  "vitest.config.ts":
    "export default { test: { coverage: { enabled: true } } };",
};
const PROFILE = "version: 1\nname: x\ntype: cli\n";

const coverage = async (dir: string, runCommands = false) =>
  runDetector(buildContext(dir, { runCommands }), { type: "coverage" });

describe("coverage floor", () => {
  it("records the first measurement as the baseline, then holds it", async () => {
    const dir = await repoWith({
      ...CONFIGURED,
      "coverage/coverage-summary.json": summary(61.8),
    });
    expect((await coverage(dir)).status).toBe("pass");
    expect(await ratchetCoverageBaseline(buildContext(dir), "2026-11-09")).toBe(
      61,
    );
    expect((await readQualityFile(dir)).coverage).toEqual({
      lines: 61,
      recorded: "2026-11-09",
    });

    await writeFile(join(dir, "coverage/coverage-summary.json"), summary(58));
    const dropped = await coverage(dir);
    expect(dropped.status).toBe("fail");
    expect(dropped.message).toContain("below the floor of 61%");
  });

  it("ratchets up, never down", async () => {
    const dir = await repoWith({
      "coverage/coverage-summary.json": summary(70.4),
      ".factory/quality.json": JSON.stringify({
        coverage: { lines: 60, recorded: "2026-11-01" },
      }),
    });
    expect(await ratchetCoverageBaseline(buildContext(dir), "2026-11-09")).toBe(
      70,
    );
    await writeFile(join(dir, "coverage/coverage-summary.json"), summary(65));
    expect(
      await ratchetCoverageBaseline(buildContext(dir), "2026-11-10"),
    ).toBeNull();
    expect((await readQualityFile(dir)).coverage?.lines).toBe(70);
  });

  it("uses the profile's quality.coverage instead of the baseline", async () => {
    const dir = await repoWith({
      ".factory/profile.yml": `${PROFILE}quality:\n  coverage: 80\n`,
      "coverage/coverage-summary.json": summary(75),
    });
    expect((await coverage(dir)).message).toContain("profile quality.coverage");
    expect((await coverage(dir)).status).toBe("fail");
    expect(
      await ratchetCoverageBaseline(buildContext(dir), "2026-11-09"),
    ).toBeNull();
  });

  it("fails in the judge when coverage is configured but no summary was written", async () => {
    const dir = await repoWith(CONFIGURED);
    expect((await coverage(dir, true)).status).toBe("fail");
    // A routine audit didn't run the tests, so it can't know.
    expect((await coverage(dir, false)).status).toBe("skip");
  });

  it("skips when coverage isn't configured at all", async () => {
    const dir = await repoWith({ "package.json": "{}" });
    expect((await coverage(dir, true)).status).toBe("skip");
  });
});
