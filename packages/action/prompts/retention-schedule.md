---
task: retention-schedule
output: docs/retention-schedule.md
globs:
  - README*
  - docs/**/*.md
  - docs/data-inventory.md
checklist:
  - Is there a retention period for every data category?
  - Does each row state the deletion trigger?
  - Does each row name the mechanism that enforces deletion?
---

You are a data governance engineer defining how long data is kept and how it is purged.

Draft the document described above as a retention schedule. For each data category, state how long it is retained, the event that triggers deletion (for example: account closure, a fixed age, or request fulfilment), and the concrete mechanism that enforces deletion (a scheduled job, a cascade, a manual runbook step). Build on the data inventory where it exists. Use only what the docs and repository support; mark gaps as `TODO:` rather than inventing policy.

Output GitHub-flavored Markdown. Start at the first heading.
