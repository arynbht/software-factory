// Coverage ratchet: the floor is the profile's `quality.coverage`, else the
// baseline recorded in `.factory/quality.json` at the first measured run. The
// baseline only ever moves up.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "./context.js";
import type { DetectorResult } from "./detectors/types.js";
import { compileRegex, splitGlobs } from "./detectors/util.js";
import { writeFileAtomic } from "./fs-atomic.js";

export const QUALITY_FILE = ".factory/quality.json";
export const DEFAULT_SUMMARY = "coverage/coverage-summary.json";

export interface QualityBaseline {
  coverage?: { lines: number; recorded: string } | undefined;
}

/** Where coverage is set up: if any of these mention it, a run must report it. */
const COVERAGE_CONFIG = {
  path: "vitest.config.ts|vitest.config.js|vitest.config.mjs|vitest.config.mts|jest.config.js|jest.config.ts|jest.config.mjs|package.json|.nycrc|.nycrc.json|.c8rc.json|pyproject.toml|.coveragerc|setup.cfg|tox.ini",
  pattern: "(?i)(coverage|--cov\\b)",
};

export async function loadQualityBaseline(
  ctx: AuditContext,
): Promise<QualityBaseline> {
  const text = await ctx.readFile(QUALITY_FILE);
  if (!text) return {};
  try {
    return JSON.parse(text) as QualityBaseline;
  } catch {
    return {};
  }
}

/** Line coverage (%) from an Istanbul json-summary, or null if absent/unreadable. */
export async function readLineCoverage(
  ctx: AuditContext,
  summary = DEFAULT_SUMMARY,
): Promise<number | null> {
  const text = await ctx.readFile(summary);
  if (!text) return null;
  try {
    const pct = (JSON.parse(text) as { total?: { lines?: { pct?: unknown } } })
      .total?.lines?.pct;
    return typeof pct === "number" ? pct : null;
  } catch {
    return null;
  }
}

async function coverageConfigured(ctx: AuditContext): Promise<boolean> {
  const regex = compileRegex(COVERAGE_CONFIG.pattern);
  for (const rel of await ctx.glob(splitGlobs(COVERAGE_CONFIG.path))) {
    if (regex.test((await ctx.readFile(rel)) ?? "")) return true;
  }
  return false;
}

type CoverageConfig = Extract<DetectorConfig, { type: "coverage" }>;

/**
 * Line coverage must be at or above the floor. A missing summary is a failure
 * where tests have just run (the judge: `runCommands`) and coverage is set up —
 * coverage that silently stopped being reported must not pass — and a skip in a
 * routine audit, where the tests weren't run.
 */
export async function coverageDetector(
  ctx: AuditContext,
  config: CoverageConfig,
): Promise<DetectorResult> {
  const summary = config.summary ?? DEFAULT_SUMMARY;
  const measured = await readLineCoverage(ctx, summary);
  if (measured === null) {
    if (!(await coverageConfigured(ctx))) {
      return {
        status: "skip",
        message: "coverage isn't configured (see test.coverage-config)",
      };
    }
    return ctx.runCommands
      ? {
          status: "fail",
          message: `coverage is configured, but the test run wrote no ${summary}`,
          remediation:
            "make the test command report coverage with the json-summary reporter",
        }
      : {
          status: "skip",
          message: `no ${summary}; run the tests (or \`factory judge\`) to measure`,
        };
  }

  const profile = await ctx.profile().catch(() => null);
  const set = profile?.quality?.coverage;
  const baseline = (await loadQualityBaseline(ctx)).coverage?.lines;
  const floor = set ?? baseline;
  if (floor === undefined) {
    return {
      status: "pass",
      message: `${measured}% lines; no floor yet — \`factory audit\` records this as the baseline`,
    };
  }
  const source = set !== undefined ? "profile quality.coverage" : QUALITY_FILE;
  return measured >= floor
    ? {
        status: "pass",
        message: `${measured}% lines ≥ floor ${floor}% (${source})`,
      }
    : {
        status: "fail",
        message: `${measured}% lines is below the floor of ${floor}% (${source})`,
        remediation:
          "add tests for the uncovered code, or lower the floor deliberately",
      };
}

/**
 * Record or raise the coverage baseline from the current summary: the first
 * measurement sets it, a higher one raises it, a lower one never lowers it.
 * Stored rounded down. Returns the new baseline, or null when nothing changed.
 * Skipped when the profile sets `quality.coverage` (the human chose the floor).
 */
export async function ratchetCoverageBaseline(
  ctx: AuditContext,
  date: string,
): Promise<number | null> {
  const profile = await ctx.profile().catch(() => null);
  if (profile?.quality?.coverage !== undefined) return null;
  const measured = await readLineCoverage(ctx);
  if (measured === null) return null;
  const floor = Math.floor(measured);
  const current = await loadQualityBaseline(ctx);
  if (current.coverage && current.coverage.lines >= floor) return null;
  const next: QualityBaseline = {
    ...current,
    coverage: { lines: floor, recorded: date },
  };
  await writeFileAtomic(
    join(ctx.repoPath, QUALITY_FILE),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return floor;
}

/** For tests and callers outside a context. */
export async function readQualityFile(
  repoPath: string,
): Promise<QualityBaseline> {
  try {
    return JSON.parse(
      await readFile(join(repoPath, QUALITY_FILE), "utf8"),
    ) as QualityBaseline;
  } catch {
    return {};
  }
}
