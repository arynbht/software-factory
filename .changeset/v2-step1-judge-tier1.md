---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
"@arynbht/factory-runtime": minor
---

Factory v2 step 1, "before the judge": `factory judge` (tier 1) runs lint,
typecheck and tests on a clean clone of base plus the change, with scripts,
`.factory/**`, lint/CI config and existing tests taken from base; fails closed,
compares against base, and marks protected changes `needs-human`. New `quality`
lane (lint/typecheck/tests pass, coverage floor, required checks); command
detectors run only in the judge or with `audit --commands`. CI and security
controls read workflow YAML paths (every action pinned, no `write-all`,
`--if-present` doesn't count, `factory.yml` never counts). Strict control
schemas, `valid-for` and `managed` on controls, and Claude-fixed controls need a
filled `reviewed-by:` or evidence.
