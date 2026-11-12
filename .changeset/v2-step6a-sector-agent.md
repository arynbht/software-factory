---
"@arynbht/factory-runtime": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-registry": minor
"@arynbht/factory": minor
---

Factory v2 step 6a: isolation and the sector agent. `factory task isolate <id>` gives an
approved task its own worktree under `.worktrees/`, branch `<type>/<id>`, port and
database name, with git hooks off inside it. `factory task build <id>` plans first
(read-only, recorded in the ledger before any edit), then runs one writer in the
worktree with a prompt assembled in a fixed order (AGENTS.md from the base, the card,
the assembly's skills verified against the lock, a size-capped repo slice, the
operating rules) on an allowlisted environment. The runtime commits, then checks the
diff: a new dependency, a schema change, a sensitive or protected path, or a plan over
budget pauses the task until `factory task answer <id> --allow|--deny`.
