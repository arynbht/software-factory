---
"@arynbht/factory": minor
---

Add `markdown` and `github` report formats to `factory audit --format`. Markdown
renders a PR-comment/job-summary-friendly table of blocking controls; github emits
`::error`/`::warning` workflow annotations plus a summary line (used by the Action).
