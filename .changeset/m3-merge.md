---
"@arynbht/factory-engine": minor
"@arynbht/factory-catalog": patch
---

Add the `merge-json` and `merge-yaml` generators: they set a dot/bracket path to a
value inside an existing file with a minimal, formatting- and comment-preserving
edit (jsonc-parser `modify` for JSON; the `yaml` Document round-trip for YAML),
no-op when the value already matches, and create the file if absent. Gives the
`ci.workflow-permissions`/`ci.concurrency` controls actionable values. (CI-step
*append* fixes, which need more than a path-set, remain no-ops for now.)
