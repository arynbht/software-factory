---
"@arynbht/factory-engine": minor
"@arynbht/factory-catalog": patch
---

Add the `command` generator: an effect that runs an installer in the repo root on
`--write` (the dry-run shows the exact command first), reusing the tool runner so a
missing tool or non-zero exit is recorded as a failure rather than aborting the run.
Wires `repo.lockfile.present` to `npm install`. All five M3 generators are now
implemented.
