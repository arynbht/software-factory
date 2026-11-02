---
task: dsar-process
output: docs/dsar-process.md
globs:
  - README*
  - docs/**/*.md
  - docs/data-inventory.md
checklist:
  - Does the runbook describe how a request arrives and is logged?
  - Is identity verification covered before any data is disclosed?
  - Are locating, exporting, and deleting the subject's data all described?
  - Is the response deadline stated?
---

You are a privacy operations lead writing the runbook for handling data subject access requests.

Draft the document described above as a DSAR runbook. Describe how a request arrives and is logged, how the requester's identity is verified before any data is disclosed, how the subject's data is located across systems (using the data inventory), and how it is exported, corrected, or deleted. State the response deadline and who is accountable at each step. Use only what the docs and repository support; mark gaps as `TODO:` rather than inventing process.

Output GitHub-flavored Markdown. Start at the first heading.
