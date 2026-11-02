---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": patch
---

Add the AI task prompt templates (invokable via `factory ai <task>`): `brief`,
`stories`, `adr`, `c4`, `threat-model`, `runbook`, `test-scaffold`,
`license-summary` (plus `explain-gaps`). Each pins its output path, context globs,
and a reviewer checklist, and instructs the model to mark unknowns as `TODO:` rather
than invent facts. `sec.threat-model` is control-wired to the `threat-model` task;
the rest are standalone until M6 adds their controls. The `claude` generator now
degrades to no change when there's no API key, so a mixed `factory fix` run never
aborts on an AI control — AI drafts are produced on demand via `factory ai`, which
surfaces the missing key. A drift test loads and validates every bundled prompt.
(`changelog` is deferred — it needs git-log input the context packer doesn't provide
yet.)
