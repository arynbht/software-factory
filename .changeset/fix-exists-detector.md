---
"@arynbht/factory-engine": patch
"@arynbht/factory-catalog": patch
---

Honor the `exists` option in the `file-json-path` / `file-yaml-path` detectors.
It was declared in the schema but never read, so `exists: false` (assert the
path is absent) silently passed exactly when the path was present — the opposite
of its intent. `exists: false` now passes only when the path is absent in every
matched file; `exists: true` / omitted keeps the existing "path must exist"
behavior. The schema description is updated to match.
