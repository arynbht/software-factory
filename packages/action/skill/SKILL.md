---
name: factory
description: >-
  Run a change through the software factory: intake → route → isolate → build →
  prove → judge → ship → close, with a person confirming the card, approving the
  route, answering stop-and-ask questions and merging. Use for any task in this
  repo ("/factory add dark mode", "/factory #42"), and for "/factory status" and
  "/factory resume T-0003". Also use when asked what's left to do in the repo
  (`factory audit`).
---

# /factory

This repo runs on the software factory (AGENTS.md is the contract). You drive the
`factory` CLI and talk to the person. The CLI does the work: it writes the task
card and the ledger, makes the worktree, runs the sector agent, produces the proof,
judges the change and opens the PR. You don't edit code for a factory task yourself.

## Rules

- Never edit `.factory/**`, the ledger, or anything in `.worktrees/`. The runtime
  writes them, and a hook will refuse.
- Every approval belongs to the person. Ask the question in the chat and wait for a
  clear yes. Only then run the command with `--yes`, which the ledger records as
  approved through you. Never pass `--yes` on your own judgment.
- Report what the CLI prints. Don't summarise a failure as a success or invent a
  next step: every command ends with `next: …`, and that is the next step.
- The factory never merges. Neither do you.

## /factory status

Run `factory task status` and show each open task with its next step.

## /factory resume <id>

Run `factory task resume <id>`. It verifies the ledger and prints it with the next
step. Carry on from that step in the flow below. If verification fails, stop and
show the problems: a ledger that fails verification has been tampered with.

## /factory <task text or #issue>

1. **Sync.** Run `factory doctor`. On a ✗, do what it says (usually
   `factory skills sync`) and run it again. Don't start a task on a failing doctor.

2. **Intake.** Work out the card with the person:
   - title, type (`feature | fix | chore | refactor | spike`), and a description of
     what and why. For an issue, read it with `gh issue view <n>` and use
     `--source issue#<n>`.
   - acceptance criteria. Each one is a concrete, checkable sentence with a verify
     kind: `e2e | unit | manual | screenshot | contract | review`. If the task is
     vague, interview the person one question at a time until every criterion is
     concrete. Don't guess criteria.
   - optional: `--touches <glob>` for the paths it will change, `--page /path` for
     the pages a UI proof should shoot, `--out-of-scope`, `--constraint`,
     `--risk low|medium|high`.

   Then draft it:

   ```bash
   factory task new "<title>" --type fix --description "<what and why>" \
     --accept "<criterion>::unit" --accept "<criterion>::e2e" --touches "src/x/**"
   ```

   Show the card (`.factory/tasks/<id>/card.yml`, which `factory task confirm` prints
   too) and ask: "Confirm this card?" On a clear yes, run
   `factory task confirm <id> --yes`. To change an unconfirmed card, either the
   person edits `card.yml` themselves, or you draft a corrected card with
   `factory task new` and drop the old one with
   `factory task close <old id> --abandon "redrafted as <new id>"`.

3. **Route.** Run `factory task route <id>`. Show the sectors with their reasons,
   the skills, the checks, the proof and the budget. Mention any sectors that fell
   under the threshold. Ask: "Approve this assembly?" On a clear yes, run
   `factory task approve <id> --yes`. If the person wants changes, they edit
   `.factory/tasks/<id>/assembly.yml` themselves before approving. You don't edit it.

4. **Run.** Run `factory task run <id>`. It isolates, builds, proves, judges and
   ships, printing each ledger entry as it lands. It stops when a person is
   needed, and its last line says why:
   - **stop-and-ask** (exit 2): show the question (a new dependency, a schema
     change, a protected path, the budget, or the judge needing a person) and ask
     the person. Then run `factory task answer <id> --allow "<their note>"` or
     `--deny "<what to do instead>"`, and run `factory task run <id>` again.
   - **shipped** (exit 0): show the draft PR link. The person reviews it, marks it
     ready and merges it. You don't.
   - **an error** (exit 1): show it and stop. Don't work around it by doing the
     beat's work yourself.

5. **Close.** After the person says the PR is merged (or closed), run
   `factory task close <id>`. To drop a task at any point, run
   `factory task close <id> --abandon "<why>"`. Close seals the ledger.

## What's left in this repo?

When asked about the repo's state rather than a task, run
`factory audit --format json`. Report the `fail` and `needs-evidence` controls,
highest severity first, and suggest starting the fixes as `/factory` tasks.
