---
"@arynbht/factory": minor
"@arynbht/factory-engine": minor
---

Add `factory status`: infers the project phase (the lowest phase whose gate is not
green) and lists the blocking controls (fail / needs-evidence) in severity then
effort order, each tagged with its effort. Shows every defined gate's state and the
profile's declared phase (a floor, never a ceiling). `--json` for machine output.
`ControlResult` now carries `effort` so consumers can prioritize by it.
