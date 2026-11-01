---
"@arynbht/factory-engine": minor
"@arynbht/factory": patch
---

Add the generator framework and merge policy (ADR-0004) that `factory fix` builds
on. `.factory/state.json` gains a managed-file hash registry with
`managedFileUnchanged`; `applyChanges` applies a plan of changes dry-run-by-default,
never overwriting a human-edited file (a `create` file is written only when absent
or factory-managed-and-unchanged; a `merge` file writes its already-merged
contents; effects run only in write mode) and records hashes on write. Adds the
generator type + registry + `planControls` dispatch (generators themselves land in
M3.2+). The audit now preserves the managed registry across runs.
