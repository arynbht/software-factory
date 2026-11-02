---
"@arynbht/factory-engine": patch
"@arynbht/factory": patch
---

Fix three engine date/metric correctness bugs: DORA `deploymentFrequencyPerWeek`
now returns `null` (not `Infinity`/`NaN`) when `windowDays <= 0`, matching the
other metrics; zone-less datetimes (`2026-11-01T00:00:00`) are parsed as UTC
instead of the host local timezone so a waiver or evidence date means the same
instant on a laptop and in CI; and the evidence `valid-for` window is anchored to
the start of the issue date (new `startOfDayMs`) rather than the end of that day,
removing the ~1 extra day and making the evidence window symmetric with waiver
expiry.
