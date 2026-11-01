---
"@arynbht/factory-engine": minor
---

Add the `command` and `scorecard` detectors. `command` runs a tool in the repo
root and checks its exit code or a `jsonPath` in its JSON stdout; a missing tool
is a clean skip. `scorecard` runs OpenSSF Scorecard and asserts a named check
meets a minimum score. Completes all seven M1 detector types.
