# 7. Authentication is a GitHub App with device flow, for both desktop and CI

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

The desktop shell (M5) and CI both need a GitHub token that can read admin-only
settings (branch protection, security features) and write PRs/comments/issues. How
should the factory obtain that token?

## Considered Options

- **A GitHub App, authorised via device flow.**
- An OAuth App with the classic `repo` scope.
- Personal access tokens.

## Decision Outcome

Chosen: a **GitHub App** using **device flow**. The App requests only the
permissions it needs (not blanket `repo` read/write), is installed on chosen repos,
issues expiring user tokens (safer on a laptop), and — crucially — the same App
mints an installation token in CI via `actions/create-github-app-token`, so CI and
desktop share one permission model. This fixes the problem that the default
`GITHUB_TOKEN` can't read admin-only settings that `github-api` detectors need.

Permissions: Metadata (read); Contents (read/write — files + generator branches);
Pull requests (read/write — `fix --pr`, sticky comments); Workflows (read/write —
pushes touching `.github/workflows/*`); Issues (read/write — status issue);
Administration (read; write only if generators apply rulesets); Dependabot & Secret
scanning alerts (read); Actions (read — CI duration, DORA).

### Consequences

- Good: least-privilege, repo-scoped, one model for CI and desktop.
- Good: the engine stays token-source-agnostic (`--token` / `GITHUB_TOKEN` /
  `GH_TOKEN` / `gh auth token`), so an installation token drops straight in.
- Bad: the Electron app must ship only the client ID (never the secret/private
  key); token refresh may need the secret, so v1 re-runs device flow on expiry.
- Bad: org owners must approve the install — a documented step for teammates.
- Register the App under the org, not a personal account, so ownership survives.
