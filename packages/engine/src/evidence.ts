// Reading `.factory/evidence.yml` and deciding whether a control's human evidence
// is still valid. This is the M1 stub; the full add/attach workflow lands in M2.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CONTROL_ID_PATTERN } from "@arynbht/factory-catalog";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { DAY_MS, startOfDayMs } from "./dates.js";
import { writeFileAtomic } from "./fs-atomic.js";

export class EvidenceError extends Error {}

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
  } catch (err) {
    throw new EvidenceError(
      `evidence.yml is not valid YAML: ${(err as Error).message}`,
    );
  }
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) {
    throw new EvidenceError("evidence.yml must be a list of entries");
  }

  return parsed.filter((e): e is EvidenceEntry => {
    const control = (e as { control?: unknown } | null)?.control;
    // Drop entries whose `control` isn't a real control id: it's rendered into the
    // PR/issue comment the Action posts, so an arbitrary string could carry Markdown.
    return (
      e !== null &&
      typeof e === "object" &&
      typeof control === "string" &&
      CONTROL_ID_PATTERN.test(control)
    );
  });
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

/** An entry is valid if it is dated and (if `valid-for` is set) not yet expired. */
export function isEvidenceValid(entry: EvidenceEntry, now: Date): boolean {
  if (!entry.date) return false;
  // Anchor the window to the START of the issue date so a `valid-for: 30d`
  // entry dated 2026-10-01 expires at 2026-10-31T00:00:00Z. Anchoring to the
  // end of the start day instead would grant one extra day and make the
  // evidence window asymmetric with waiver expiry (which ends at the start of
  // its expiry day's window).
  const start = startOfDayMs(entry.date);
  if (start === null) return false;

  const window = entry["valid-for"];
  if (!window) return true;
  const days = parseDuration(window);
  // Fail closed: an unparseable `valid-for` (a typo like "3m") must not make the
  // evidence immortal — treat it as invalid rather than never-expiring.
  if (days === null) return false;

  return now.getTime() <= start + days * DAY_MS;
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

/** Currently-valid evidence whose expiry falls within `days` of `now`. */
export function evidenceExpiringWithin(
  entries: EvidenceEntry[],
  days: number,
  now: Date,
): EvidenceEntry[] {
  const horizon = now.getTime() + days * DAY_MS;
  return entries.filter((e) => {
    if (!isEvidenceValid(e, now) || !e.date || !e["valid-for"]) return false;
    const durationDays = parseDuration(e["valid-for"]);
    // Same start-of-day anchor as isEvidenceValid, so the "expiring within"
    // window agrees with the validity decision above.
    const start = startOfDayMs(e.date);
    if (durationDays === null || start === null) return false;
    return start + durationDays * DAY_MS <= horizon;
  });
}

/** sha256 of a file, used to pin uploaded evidence. */
export async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/** Add (or replace the same control's) evidence entry and write evidence.yml. */
export async function addEvidence(
  repoPath: string,
  entry: EvidenceEntry,
): Promise<EvidenceEntry[]> {
  const existing = await loadEvidence(repoPath);
  const next = [...existing.filter((e) => e.control !== entry.control), entry];
  await writeFileAtomic(
    resolve(repoPath, ".factory", "evidence.yml"),
    stringifyYaml(next),
  );
  return next;
}
