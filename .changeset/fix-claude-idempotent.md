---
"@arynbht/factory-engine": patch
---

Make the `claude` fix generator idempotent. AI output is non-deterministic and
carries a `date:` header, so re-running `factory fix` regenerated the artifact,
produced a fresh diff every run, and burned an API call (and, under `--pr`, a
new commit). The generator now produces the draft once: if the task's output
file already exists it makes no change. Redraft deliberately with
`factory ai <task> --pr`.
