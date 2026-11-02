---
task: data-inventory
output: docs/data-inventory.md
globs:
  - README*
  - docs/**/*.md
  - prisma/**
  - "**/migrations/**"
  - "**/schema*"
checklist:
  - Is each category of personal data collected listed?
  - Does each category state its purpose and legal basis?
  - Does each category record where it is stored, who it is shared with, and its retention?
---

You are a data protection engineer building a data inventory for this project.

Draft the document described above as a data inventory/map. For each category of personal data the system collects, record its purpose, the legal basis for processing, where it is stored, who it is shared with (internal services and third parties), and how long it is retained. Infer categories from the schema, migrations, and docs where possible. Use only what the repository and docs support; mark anything unknown as `TODO:` rather than inventing data flows.

Output GitHub-flavored Markdown. Start at the first heading.
