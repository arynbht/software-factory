---
name: factory
description: >-
  Assess and improve a repository's engineering quality using the Software Factory
  CLI. Use when the user asks "what's left to do here?", "is this repo
  production-ready?", "what's missing?", or asks to harden, scaffold, or audit a
  project. Runs `factory audit` to get a real gap report instead of guessing, then
  fixes gaps with `factory fix` or drafts missing artifacts with `factory ai`.
---

# Factory skill

The `factory` CLI audits a repository against a catalog of engineering controls
(hygiene, CI/CD, security, testing, docs) and can remediate the gaps. Prefer it over
guessing: it gives a concrete, current picture of what passes and what's missing.

## When to use

- The user asks what is missing, incomplete, or not production-ready in a repo.
- The user asks to scaffold, harden, or set up CI/security/testing.
- Before claiming a repo is "done" — verify with an audit rather than asserting.

## Workflow

1. **Audit first — never guess.** Run the audit as JSON and read the gaps:

   ```bash
   factory audit --format json
   ```

   Each control has a `status` (`pass` / `fail` / `needs-evidence` / `skip` /
   `waived` / `n/a`), a `lane`, and a `severity`. Focus on `fail` and
   `needs-evidence`, highest severity first. To check a phase gate:

   ```bash
   factory audit --gate build   # or scaffold / harden; exits non-zero if red
   ```

2. **Fix deterministic gaps** (missing config, CI steps, scaffolding). Preview
   first, then apply:

   ```bash
   factory fix --gate build          # dry-run preview of what it would change
   factory fix --gate build --write  # apply locally
   factory fix --pr                  # or open a pull request with the changes
   ```

   `fix` never clobbers a human-edited file; it only creates missing files or
   merges into ones it manages.

3. **Draft the artifacts nobody writes by hand** (threat model, ADRs, user
   stories, runbooks, C4 diagrams, a gap narrative). Use `factory ai`:

   ```bash
   factory ai explain-gaps           # a prioritized narrative of what's missing
   factory ai threat-model --pr      # a STRIDE threat model as a PR
   factory ai adr                     # an architecture decision record
   ```

   `factory ai <task>` needs `ANTHROPIC_API_KEY`. Output is always a draft for a
   human to review — generated files carry a `reviewed-by:` header that stays empty
   until someone signs off, and control evidence still requires a human entry.

4. **Report back** with the prioritized gaps, what you fixed, and what still needs
   a human (manual controls, settings that need a token, judgment calls).

## Principles

- **Claude drafts, humans sign.** A generated threat model or ADR does not pass the
  gate until a person reviews it.
- Run `factory audit` again after changes to confirm the gap actually closed.
- If a control is `skip` because a tool or token is missing, say so rather than
  treating it as passing.
- Don't invent findings — rely on the audit output.
