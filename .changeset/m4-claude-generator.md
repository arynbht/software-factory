---
"@arynbht/factory-engine": minor
"@arynbht/factory-catalog": minor
---

Add the `claude` generator framework. Prompt templates live at
`packages/catalog/prompts/<task>.md` (YAML front-matter: `task`, `output`, `globs`,
`control`, `checklist`; body = the system prompt), loaded via `bundledPromptsDir` /
`loadPrompt`. `generateArtifact(ctx, task, …)` packs secret-guarded context, calls
the model, and renders the file with the review convention — a provenance header
(generated-by / date / model / files-consulted / empty `reviewed-by:`) plus the
reviewer checklist, both as Markdown comment blocks ("Claude drafts, humans sign").
The `claude` fix type is now wired into the generator registry (via `context.ai()`),
and the first task (`explain-gaps`) ships with a fixture test driven by a recorded
response. The action bundle copies `prompts/` and folds it into the staleness hash.
