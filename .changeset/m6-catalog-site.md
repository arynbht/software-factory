---
"@arynbht/factory-catalog": patch
---

Add `pnpm catalog:site`: render every control to browsable Markdown under
`docs/catalog/` — one page per lane (id, title, phase/severity/effort,
detector/fix summary, rationale, references) plus an index with per-lane counts.
CI checks the output is current (regenerate + `git diff`), so the catalog is always
readable on GitHub without drifting from the YAML.
