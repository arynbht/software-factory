---
"@arynbht/factory-engine": patch
"@arynbht/factory-catalog": patch
---

Harden the engine after the M2 review: waiver/evidence expiry now uses an inclusive
end-of-day for bare `YYYY-MM-DD` dates (they no longer expire ~a day early); a gate
whose selector matches nothing is `amber`, not silently `green`; `loadEvidence`
throws on a malformed file instead of silently returning none; config writes
(`addWaiver`/`addEvidence`/`saveProfile`) are atomic (temp + rename); the CI
comment/status-issue upserts paginate and reopen a closed status issue instead of
duplicating; and waiver `expires`/`created` are validated as ISO dates.
