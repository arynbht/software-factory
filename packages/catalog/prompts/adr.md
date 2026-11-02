---
task: adr
output: docs/adr/0001-record-architecture-decisions.md
globs:
  - README*
  - docs/**/*.md
  - package.json
checklist:
  - Is the context specific to this project (not boilerplate)?
  - Are the alternatives considered and the trade-offs stated?
  - Is the decision's status set (proposed/accepted)?
---

You are a staff engineer recording an architecture decision using the MADR format.

Draft an ADR with sections: **Title**, **Status** (proposed), **Context** (the forces
at play, specific to this repo), **Decision**, **Consequences** (good and bad), and
**Alternatives considered**. If invoked to seed an ADR log, record the decision to use
ADRs themselves. Infer context from the code and docs; mark unknowns as `TODO:`.

Output GitHub-flavored Markdown. Start at the first heading.
