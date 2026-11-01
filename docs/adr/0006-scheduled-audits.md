# 6. The CI workflow runs on a weekly schedule, not only on PRs

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

Gates can turn red with no commit to trigger a PR check: waivers and evidence
expire by date, GitHub settings drift when someone changes them in the UI, and new
OSV/Scorecard advisories land overnight. A workflow that runs only on
`pull_request`/`push` never notices these.

## Considered Options

- **Run `factory.yml` on `pull_request`, `push`, a weekly `schedule`, and
  `workflow_dispatch`, with different behaviour per trigger.**
- PR/push only (misses time- and drift-based failures).
- A separate scheduled workflow (duplicates setup).

## Decision Outcome

Chosen: one workflow with all four triggers. **PRs are the enforcement point** —
the job posts a sticky comment and fails when the gate is red. **Scheduled/push
runs are the signal, not a gate** — they write the report to the job summary,
open/update one pinned "Factory status" issue (and close it when green), and
**never fail the job** (a red ✗ on `main` that nobody owns is noise). The cron is
`17 6 * * 1` (Mondays 06:17 UTC — off the top of the hour, when GitHub's scheduler
is busiest).

### Consequences

- Good: expiry, settings drift, and new advisories surface within a week.
- Good: the status issue is an owned, actionable signal.
- Bad: two GitHub behaviours to document — scheduled workflows run only on the
  default branch, and public repos disable scheduled workflows after ~60 days of
  inactivity (a dormant project silently stops self-auditing).
- The scheduled run needs `issues: write`.
