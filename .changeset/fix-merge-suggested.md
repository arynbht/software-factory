---
"@arynbht/factory": patch
"@arynbht/factory-engine": patch
---

Honor the merge policy's `.factory-suggested` escape hatch. A `merge` fix that
targets a file the factory previously wrote but a human has since edited no
longer re-serializes over those edits; it writes the merged result alongside as
`<path>.factory-suggested` and reports a `suggest` action so the human can
reconcile it by hand. First-time merges into a human-authored file (minimal
structural insertion) are unchanged.
