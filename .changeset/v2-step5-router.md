---
"@arynbht/factory-runtime": minor
"@arynbht/factory-registry": minor
"@arynbht/factory-cli": minor
---

Factory v2 step 5: the router. `factory task route <id>` routes a confirmed card to an
assembly (sectors, phases, at most four task skills with conflicts and requirements
resolved, spine skills, budget, checks, proof type, review options, stop-and-ask, gaps)
in `.factory/tasks/<id>/assembly.yml`, with the reason for every decision in the ledger.
Deterministic: built-in sector signals plus manifest triggers and profile flags.
`factory task approve <id>` re-validates a possibly edited assembly and seals its hash,
so a later edit fails verification. Routing refuses skills that weren't synced.
