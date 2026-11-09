---
"@arynbht/factory-runtime": minor
"@arynbht/factory-cli": minor
---

Factory v2 step 3: task cards and the ledger. `factory task new|confirm|status|resume`.
A card is refused unless every acceptance criterion says how it's verified; nothing
runs until a person confirms it, and confirmation seals the card's hash. The ledger is
an append-only, HMAC-chained `ledger.jsonl` (per-machine key outside every repo) with
a rendered `ledger.md`; edits, forged entries, hand edits to the view and post-
confirmation card changes are detected, and `resume` refuses a record that fails. Task
records live in the primary checkout's git-ignored `.factory/tasks/`, so a task's
worktree never holds the ledger.
