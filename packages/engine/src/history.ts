// Hygiene trend: on each CI run the Action appends a per-lane pass snapshot to
// `.factory/history.jsonl` so `factory metrics` can show whether coverage is moving.
// (Persisting it across CI runs — committing it back — is a separate mechanism.)

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ControlResult } from "./evaluate.js";

export interface LaneCount {
  pass: number;
  total: number;
}

export interface HistoryEntry {
  /** YYYY-MM-DD (injected; the engine never reads the clock). */
  date: string;
  byLane: Record<string, LaneCount>;
}

const HISTORY_PATH = ".factory/history.jsonl";

/** Per-lane pass/total from a set of results (n/a and waived count as "not failing"). */
export function laneCounts(
  results: ControlResult[],
): Record<string, LaneCount> {
  const byLane: Record<string, LaneCount> = {};
  for (const r of results) {
    if (r.status === "n/a") continue;
    byLane[r.lane] ??= { pass: 0, total: 0 };
    byLane[r.lane]!.total++;
    if (r.status === "pass" || r.status === "waived") byLane[r.lane]!.pass++;
  }
  return byLane;
}

/** Append one trend snapshot as a JSON line. */
export async function appendHistory(
  repoPath: string,
  entry: HistoryEntry,
): Promise<void> {
  await appendFile(
    resolve(repoPath, HISTORY_PATH),
    `${JSON.stringify(entry)}\n`,
    { encoding: "utf8" },
  );
}

/** Read the trend history; a missing file is an empty history. */
export async function loadHistory(repoPath: string): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoPath, HISTORY_PATH), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch {
      // Skip a corrupt line rather than failing the summary.
    }
  }
  return entries;
}
