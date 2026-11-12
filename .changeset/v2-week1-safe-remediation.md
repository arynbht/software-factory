---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Make remediation safe on repos the factory did not scaffold (Factory v2 §3.1):
stack detection from manifests (node/python/go/rust, `unknown` skips stack files),
CI merges find the real job instead of inventing `jobs.ci`, merges into one file
accumulate in a single run, `merge-json` never overwrites a human's value, SHA-pinned
first-run-safe CI templates (plus go and rust), `project:` profile fields instead of
`@OWNER`/`security@example.com` placeholders, `any-of` detectors and `{ file }`
applicability, phase floor in `status`, severity floor no longer lowers gates,
`chore(factory):` commits, and a 60 s timeout on `command` detectors.
