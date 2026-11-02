---
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Add AI usage accounting. Every `factory ai` call appends a JSON line (date, task,
model, tokens, estimated USD cost) to `.factory/ai-usage.log` (gitignored), and
`factory ai usage` summarizes it — totals plus per-task and per-day breakdowns. Cost
is estimated from a small per-model price table; an unpriced model counts as $0.
Logging never fails the command.
