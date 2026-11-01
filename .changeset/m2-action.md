---
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Add the composite GitHub Action. A hidden `factory ci` command audits the
checked-out repo, writes the report to the job summary, and either posts a sticky
PR comment (failing the job when the gate is red) or maintains a pinned "Factory
status" issue on scheduled runs (never failing the job), per ADR-0006. The CLI is
esbuild-bundled with the catalog into `packages/action/dist` (committed), and
`action.yml` runs it; CI rebuilds the bundle to catch drift.
