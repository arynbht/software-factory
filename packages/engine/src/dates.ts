export const DAY_MS = 24 * 60 * 60 * 1000;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a date string to its last-valid epoch millisecond. A bare `YYYY-MM-DD`
 * is treated as **inclusive end of day** (23:59:59.999 UTC) so a waiver or
 * evidence item dated to expire "today" stays valid through the whole day rather
 * than dying at midnight. A full datetime is used as-is. Returns null if invalid.
 */
export function endOfDayMs(dateStr: string): number | null {
  const trimmed = dateStr.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return BARE_DATE.test(trimmed) ? parsed + DAY_MS - 1 : parsed;
}
