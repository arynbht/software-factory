---
"@arynbht/factory": minor
"@arynbht/factory-runtime": minor
"@arynbht/factory-catalog": patch
---

Factory v2.1 step 7b: tasks live in the repo, on a `factory/tasks` branch.

- Each task's record (card, assembly, ledger, env, judge rounds, proof) is a
  subtree of `factory/tasks`. Every `factory task` beat pulls the branch, runs,
  and pushes what it wrote, even when it failed part-way. A push only replaces
  that task's subtree, so a push that loses a race is redone on the new tip,
  and two people on different tasks never conflict. Without an origin, the
  branch is local.
- A lease (`lease.json`: holder and expiry, two hours past the last write) keeps
  two machines off one task. Another machine is refused before anything runs,
  until the lease expires or the holder runs `factory task release <id>`.
  `task resume` shows who holds a task.
- Task ids are reserved on the branch, so two people drafting at once get
  different ids. A card that fails validation is refused before an id is
  reserved.
- Closing a task releases its lease and appends its row to `history.jsonl` on
  the branch (once per task, even when close is re-run).
- `FACTORY_LEDGER_KEY` sets a team's shared ledger key, so a task recorded on
  one machine verifies on another, until the GitHub App holds the key.
