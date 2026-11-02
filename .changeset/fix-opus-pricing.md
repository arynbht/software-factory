---
"@arynbht/factory-engine": patch
---

Fix the Claude Opus 4.8 price table entry: it was `$15/$75` per 1M tokens (the
Opus 4.1 rate) but Opus 4.8 is `$5/$25`. Every Opus cost estimate in
`.factory/ai-usage.log`, the `factory ai` cost line, and `factory ai usage` was
inflated 3×.
