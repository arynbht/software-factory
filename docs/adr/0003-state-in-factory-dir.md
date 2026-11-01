# 3. Shared state lives in `.factory/` in the target repo; personal state in the app

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

The factory produces configuration (profile, waivers, evidence) and runtime state
(last audit, managed-file hashes). Some of this must be shared with teammates and
CI; some is personal to one user (tokens, theme). Where does each live?

## Considered Options

- **Shared state in `.factory/` inside the target repo; personal state in the
  app's user-data directory.**
- All state in the app (teammates and CI see nothing).
- All state in the repo (tokens and personal prefs leak into git).

## Decision Outcome

Chosen: **the repo is the source of truth.** `.factory/profile.yml`,
`waivers.yml`, `evidence.yml`, `state.json`, and `history.jsonl` live in the
target repo so teammates and CI read the same config. Personal preferences and
secrets live in the app's `userData` directory (or the environment for the CLI)
and never enter the repo. There is no third place.

### Consequences

- Good: CI, CLI, and app agree on configuration.
- Good: changes to profile/waivers are reviewable in PRs.
- Bad: requires a strict boundary so tokens never land in `.factory/` or logs
  (enforced by a token-shaped-string test on all output).
