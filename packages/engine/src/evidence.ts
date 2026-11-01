// Reading `.factory/evidence.yml` and deciding whether a control's human evidence
// is still valid. This is the M1 stub; the full add/attach workflow lands in M2.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";

export interface EvidenceEntry {
  control: string;
  url?: string | undefined;
  sha256?: string | undefined;
  reviewer?: string | undefined;
  date?: string | undefined;
  note?: string | undefined;
  /** Age-out window, e.g. "365d", "26w", "1y". Omitted = never expires. */
  "valid-for"?: string | undefined;
}

/** Load evidence entries from `<repo>/.factory/evidence.yml` (missing → none). */
export async function loadEvidence(repoPath: string): Promise<EvidenceEntry[]> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoPath, ".factory", "evidence.yml"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (e): e is EvidenceEntry =>
      e !== null &&
      typeof e === "object" &&
      typeof (e as { control?: unknown }).control === "string",
  );
}

/** Parse a duration like "365d", "26w", "1y" into days; null if unparseable. */
export function parseDuration(value: string): number | null {
  const match = /^(\d+)\s*([dwy]?)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  switch (match[2]) {
    case "w":
      return amount * 7;
    case "y":
      return amount * 365;
    default:
      return amount;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** An entry is valid if it is dated and (if `valid-for` is set) not yet expired. */
export function isEvidenceValid(entry: EvidenceEntry, now: Date): boolean {
  if (!entry.date) return false;
  const start = new Date(entry.date);
  if (Number.isNaN(start.getTime())) return false;

  const window = entry["valid-for"];
  if (!window) return true;
  const days = parseDuration(window);
  if (days === null) return true;

  return now.getTime() <= start.getTime() + days * DAY_MS;
}

/** The first valid evidence entry for a control, or null. */
export function findValidEvidence(
  entries: EvidenceEntry[],
  controlId: string,
  now: Date,
): EvidenceEntry | null {
  return (
    entries.find((e) => e.control === controlId && isEvidenceValid(e, now)) ??
    null
  );
}
