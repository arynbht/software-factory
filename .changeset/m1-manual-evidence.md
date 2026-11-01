---
"@arynbht/factory-engine": minor
---

Add the evidence stub and `manual` control handling. `loadEvidence` reads
`.factory/evidence.yml` (cached on the context) and `findValidEvidence` honours
`valid-for` expiry. `evaluateControl` now satisfies a `manual` detector from a
valid, unexpired evidence entry and otherwise reports the fourth control status,
`needs-evidence`.
