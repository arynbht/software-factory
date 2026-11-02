export const DAY_MS = 24 * 60 * 60 * 1000;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A datetime with a time part but no UTC designator and no numeric offset
// (e.g. `2026-11-01T00:00:00`). V8's Date.parse reads such a value in the HOST
// LOCAL timezone, so the same waiver/evidence date means a different instant on
// a laptop and in CI. The engine pins it to UTC so the value is deterministic.
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// A trailing UTC designator or numeric offset — its presence means Date.parse
// already interprets the value without the host local timezone.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse a date string to epoch milliseconds, deterministic across timezones.
 * A bare `YYYY-MM-DD` is midnight UTC. A zone-less datetime is parsed as UTC
 * (never the host local timezone). A datetime carrying a `Z` or a numeric
 * offset is used as-is. Returns null if unparseable.
 */
function toUtcMs(dateStr: string): number | null {
  const trimmed = dateStr.trim();
  if (BARE_DATE.test(trimmed)) return Date.parse(`${trimmed}T00:00:00Z`);
  if (ZONELESS_DATETIME.test(trimmed) && !HAS_ZONE.test(trimmed)) {
    const parsed = Date.parse(`${trimmed}Z`);
    if (Number.isNaN(parsed)) return null;
    return parsed;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Parse a date string to its last-valid epoch millisecond. A bare `YYYY-MM-DD`
 * is treated as **inclusive end of day** (23:59:59.999 UTC) so a waiver or
 * evidence item dated to expire "today" stays valid through the whole day rather
 * than dying at midnight. A full datetime is used as-is. Returns null if invalid.
 */
export function endOfDayMs(dateStr: string): number | null {
  const ms = toUtcMs(dateStr);
  if (ms === null) return null;
  return BARE_DATE.test(dateStr.trim()) ? ms + DAY_MS - 1 : ms;
}

/**
 * Parse a date string to the **start** of its day (00:00:00.000 UTC). A bare
 * `YYYY-MM-DD` is already midnight UTC. A zone-less datetime is the start of its
 * UTC day; a datetime with an explicit offset is floored to the UTC day that
 * contains it. Used to anchor a `valid-for` window to the start of the issue
 * date so the evidence window is symmetric with waiver expiry. Returns null if
 * unparseable.
 */
export function startOfDayMs(dateStr: string): number | null {
  const ms = toUtcMs(dateStr);
  if (ms === null) return null;
  if (BARE_DATE.test(dateStr.trim())) return ms;
  return Math.floor(ms / DAY_MS) * DAY_MS;
}
