# 4. Generators open PRs, never write to the default branch

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

The factory generates files and settings (scaffold files, CI steps, rulesets) and
drafts documents with Claude. Applying these directly to the default branch would
be fast but unreviewable and risky, especially for AI-drafted content. How should
generated changes reach a repo?

## Considered Options

- **Dry run by default; `--write` applies locally; `--pr` opens a pull request.**
- Write directly to the working tree or default branch.
- Only ever print suggestions, never apply.

## Decision Outcome

Chosen: **every run is a dry run by default.** `--write` applies changes to the
local working tree; `--pr` applies them on a branch and opens a PR titled
`factory: <n> fixes for <gate>` with one commit per control. Claude-drafted
artifacts always land on a branch or as a draft file and still require human
evidence to pass a gate. Generators never overwrite a human-edited file (tracked
via a hash registry in `state.json`).

### Consequences

- Good: every change is reviewable and revertible.
- Good: AI output is never silently merged.
- Bad: slower than direct writes; requires PR plumbing (Octokit) early.
