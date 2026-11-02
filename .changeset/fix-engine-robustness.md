---
"@arynbht/factory-engine": patch
"@arynbht/factory": patch
---

Four engine robustness fixes. Generator failures are no longer swallowed:
`planControl`/`planControls` return the changes plus a `GeneratorError[]`, and
`factory fix` prints each failure instead of silently reporting "nothing to fix".
`factory status` now applies the profile's `severity-floor` (like audit/ci/ai/fix)
so it neither infers a phase from nor lists blockers the user chose to ignore,
and derives the all-green phase from the phase list rather than a hardcoded
`"operate"`. The `github-setting` protection ruleset now requires one approving
review (was zero), so the `required-pull-request` control can't report "reviews
required" while self-merge is allowed. `merge-json` preserves a file's existing
line ending instead of forcing `\n`, avoiding a mixed-EOL whole-file diff on
Windows.
