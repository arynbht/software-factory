# Documentation & DX



Diátaxis docs, ADRs, architecture diagrams, runbooks, and changelogs.



6 control(s).



### `docs.adr-log` — ADR log started and current

- **phase**: architecture · **severity**: medium · **effort**: medium
- **detect**: `file-exists`, `reviewed` · **fix**: claude `adr`

Architecture Decision Records capture why a choice was made and what was traded off, so future contributors change the system with context rather than re-litigating settled decisions.

References:
  - [MADR](https://adr.github.io/madr/)
  - [ADR (Nygard)](https://adr.github.io/)

### `docs.c4-diagrams` — C4 context and container diagrams present

- **phase**: architecture · **severity**: low · **effort**: medium
- **detect**: `file-matches`, `reviewed` · **fix**: claude `c4`

A system-context and container view gives a new engineer the shape of the system in minutes; without it, architecture lives only in people's heads.

References:
  - [C4 model](https://c4model.com/)

### `docs.changelog-present` — Changelog present

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

A changelog tells users what changed between versions in human terms, which is the difference between a trustworthy release and a surprise.

References:
  - [Keep a Changelog](https://keepachangelog.com/)

### `docs.diataxis-layout` — docs/ follows the Diátaxis layout

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

A docs/ tree organised as tutorials, how-tos, reference, and explanation (Diátaxis) means contributors can find and add documentation predictably instead of a single sprawling README.

References:
  - [Diátaxis](https://diataxis.fr/)

### `docs.onboarding-guide` — Onboarding / getting-started guide present

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

A getting-started guide that a fresh clone can follow is the cheapest way to shorten time-to-first-contribution and catch setup rot.

References:
  - [Write the Docs — Onboarding](https://www.writethedocs.org/guide/)

### `docs.runbooks-dir` — Runbooks directory exists

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `file-exists`, `reviewed` · **fix**: claude `runbook`

Runbooks turn 3am incidents from improvisation into a checklist; a dedicated directory makes them discoverable when they are needed most.

References:
  - [Google SRE Workbook — On-call](https://sre.google/workbook/on-call/)


