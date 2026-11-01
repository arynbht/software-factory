---
"@arynbht/factory": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-catalog": minor
---

Add the `factory audit` CLI command — the first user-facing surface. It loads the
bundled catalog, evaluates every control against a repo (bounded-concurrency
`evaluateControls`), and prints a coloured table grouped by lane with a summary
line, or `--json`. Supports `--lane`, `--token`, and `--no-color`, writes
`.factory/state.json`, and exits non-zero when a critical control fails. Catalog
gains `loadBundledCatalog`; engine gains `evaluateControls` and a `title` on
`ControlResult`.
