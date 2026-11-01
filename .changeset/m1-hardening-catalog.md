---
"@arynbht/factory-catalog": patch
"@arynbht/factory-engine": patch
---

Tighten controls flagged by the M1 review to remove false passes:
`test.runner.configured` now requires a real test runner (not npm's "no test
specified" placeholder or a dependency named `test`); `ci.dependency-caching`
drops the greedy `setup-node[\s\S]*cache` match; `dev.conventional-commits` no
longer matches an incidentally-named package.json dependency; `ci.runs-on-push`
and `sec.scorecard.score` titles/rationales no longer overclaim; and
`dev.precommit-hooks` cites a relevant reference. Adds an engine test that loads
the bundled catalog and compiles every `file-matches` pattern, so a malformed
pattern fails CI instead of silently skipping at audit time.
