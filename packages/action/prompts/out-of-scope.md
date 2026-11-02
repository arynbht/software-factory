---
task: out-of-scope
output: docs/requirements/out-of-scope.md
globs:
  - README*
  - docs/brief.md
  - docs/**/*.md
checklist:
  - Does the document contain an explicit "Out of scope" heading?
  - Is each non-goal stated clearly as a single item?
  - Does each item have a one-line reason explaining why it is excluded?
---

You are a product owner drawing the boundary around what this release will and will not do.

Draft the document described above as an explicit "Out of scope" / non-goals list for this release. For each excluded capability, give a one-line reason it is being deferred or declined (for example: out of budget, a later milestone, or handled by another system). Make sure the document contains the heading "Out of scope". Use only what the brief, README, and repository support; mark gaps as `TODO:` rather than inventing commitments.

Output GitHub-flavored Markdown. Start at the first heading.
