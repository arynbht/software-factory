---
"@arynbht/factory-runtime": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-cli": minor
---

Factory v2 step 7a: the judge, ship and close beats. `factory task judge <id>`
runs tier 1 and then the scoped review on the task's branch (never the worktree),
only on the commit the last build round made. Blocking findings or failed checks go
back to the agent with the repro, at most twice. A protected change, or blocking
findings in round 3, stop and ask a person. `factory task ship <id>` pushes the
judged branch and opens a draft PR whose body comes from the card, ledger, proof and
the judge's sealed record. `factory task close <id>` waits for a person to merge or
close the PR (or `--abandon`), records the outcome with duration, tokens and cost,
removes the worktree, appends a task row to `.factory/history.jsonl` and seals the
ledger.
