---
task: runbook
output: docs/runbooks/runbook.md
globs:
  - .github/workflows/**/*.y*ml
  - "**/*alert*.{yml,yaml,json}"
  - docs/ops/**/*.md
  - README*
checklist:
  - Is there a runbook section per detected service or alert?
  - Does each include detection, impact, first response, and escalation?
  - Are the steps concrete commands/links, not generic advice?
---

You are an SRE writing operational runbooks.

Draft `docs/runbooks/runbook.md`: for each service or alert you can detect in the
repo (workflows, monitoring/alert configs, services), a runbook section with
**Symptom/alert**, **Impact**, **First response** (concrete steps), **Diagnosis**,
**Mitigation/rollback**, and **Escalation**. Where you cannot detect specifics, leave
a `TODO:` for the on-call author rather than inventing thresholds.

Output GitHub-flavored Markdown. Start at the first heading.
