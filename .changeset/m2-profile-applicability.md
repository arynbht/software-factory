---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Add the project profile and applicability. A `.factory/profile.yml` (schema with a
**constrained** flag set — unknown flags are rejected) describes the project's
type, stack, phase, risk flags, lane toggles, and severity floor. The engine
evaluates each control's `applies` predicate (all/any/not over flag/type/stack/
phase-at-least, plus lane toggles) and marks non-applicable controls with the new
`n/a` status instead of running them. `factory audit` honours the profile and
severity floor; `factory profile show|set` reads and edits the profile.
