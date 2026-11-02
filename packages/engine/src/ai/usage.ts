// AI usage accounting: every call appends a JSONL line to `.factory/ai-usage.log`
// (gitignored) so the monthly cost is visible. Cost is estimated from a small
// per-model price table; an unknown model is counted with a zero estimate.

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AiUsage } from "./client.js";

export interface UsageEntry {
  /** YYYY-MM-DD (injected; the engine never reads the clock). */
  date: string;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD cost for this call. */
  costUsd: number;
}

/** USD per 1M tokens, [input, output]. Approximate; update as pricing changes. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-4-8": [15, 75],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

/** Estimate the USD cost of a call; 0 for an unpriced model. */
export function estimateCost(model: string, usage: AiUsage): number {
  const key = Object.keys(PRICES).find((m) => model.startsWith(m));
  if (!key) return 0;
  const [inp, out] = PRICES[key]!;
  return (usage.inputTokens / 1e6) * inp + (usage.outputTokens / 1e6) * out;
}

const LOG_PATH = ".factory/ai-usage.log";

/** Append one usage record as a JSON line. */
export async function appendUsage(
  repoPath: string,
  entry: UsageEntry,
): Promise<void> {
  await appendFile(resolve(repoPath, LOG_PATH), `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
  });
}

/** Read all usage records; a missing log is an empty history. */
export async function loadUsage(repoPath: string): Promise<UsageEntry[]> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoPath, LOG_PATH), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: UsageEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as UsageEntry);
    } catch {
      // Skip a corrupt line rather than failing the whole summary.
    }
  }
  return entries;
}

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  byTask: Record<string, { calls: number; costUsd: number }>;
  byDay: Record<string, { calls: number; costUsd: number }>;
}

/** Aggregate usage records into totals plus per-task and per-day breakdowns. */
export function summarizeUsage(entries: UsageEntry[]): UsageSummary {
  const summary: UsageSummary = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    byTask: {},
    byDay: {},
  };
  for (const e of entries) {
    summary.calls++;
    summary.inputTokens += e.inputTokens;
    summary.outputTokens += e.outputTokens;
    summary.costUsd += e.costUsd;
    summary.byTask[e.task] ??= { calls: 0, costUsd: 0 };
    summary.byTask[e.task]!.calls++;
    summary.byTask[e.task]!.costUsd += e.costUsd;
    summary.byDay[e.date] ??= { calls: 0, costUsd: 0 };
    summary.byDay[e.date]!.calls++;
    summary.byDay[e.date]!.costUsd += e.costUsd;
  }
  return summary;
}
