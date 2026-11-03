---
"@arynbht/factory-catalog": major
"@arynbht/factory-engine": major
"@arynbht/factory": major
---

1.0.0 — first stable release.

Software Factory audits a GitHub repository against a data-driven catalog of controls,
reports the gaps by phase and discipline, and generates the fixes as pull requests.
This is the first version with a committed public API across all clients.

- **Engine** — profile resolution and applicability, ~40 detectors (file, YAML, and
  GitHub API), phase gates, template/merge/`claude` generators, the Claude API +
  Claude Code CLI transports, and the GitHub API layer with caching.
- **CLI** (`factory`) — `init`, `audit` (+ `--all`), `fix` (dry-run diff, apply, open
  PR), `ai <task>` (20 prompt tasks incl. changelog), `status` (phase inference),
  `metrics` (DORA + history), `waive`, `evidence`, `profile`.
- **Action** — runs the audit in CI, comments the gap summary on PRs, fails the job
  when the phase gate is red.
- **Catalog** — 99 controls across 14 lanes, each with references and a rationale;
  gates for all nine phases; 20 AI prompt templates.
- **Desktop** — Electron shell (Repos → audit → scorecard, profile, gates, fix, AI,
  docs, settings) with device-flow sign-in, a strict security baseline, Playwright
  e2e, and electron-builder packaging with Electron fuses.
