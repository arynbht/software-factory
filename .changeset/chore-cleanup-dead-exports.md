---
"@arynbht/factory-catalog": patch
"@arynbht/factory": patch
---

Dead-code cleanup. Remove the unused taxonomy exports `LaneCode`, `PHASE_BY_KEY`,
`ProjectType`, `FlagKey`, and `Effort`, and make `PhaseDef` internal (none were
imported anywhere; `LaneKey`/`LaneDef`/`PhaseKey` stay exported because exported
consts reference them). Extract a shared `today()` helper in the CLI, replacing
the `new Date().toISOString().slice(0, 10)` duplicated across the waiver,
evidence, fix, AI, and CI paths. Add an `assertNever` exhaustiveness guard to the
`fixSummary` switch in `site.cli.ts` so a future fix type can't silently render
"undefined" into `docs/catalog/`.
