/**
 * Today's date as an ISO `YYYY-MM-DD` string (UTC). Pass a `Date` to format a
 * specific instant. Centralises the `toISOString().slice(0, 10)` that waiver,
 * evidence, fix, and AI commands all stamp their records with.
 */
export function today(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
