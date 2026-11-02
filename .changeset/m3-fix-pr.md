---
"@arynbht/factory": minor
"@arynbht/factory-engine": minor
---

Add `factory fix --pr`: apply the plan on a dedicated `factory/<date>-<gate>`
branch, commit one change per control, push, and open a pull request titled
`factory: <n> fixes for <gate>` — reusing (and refreshing) the existing open
factory PR for that branch instead of opening duplicates. Requires a clean
working tree, skips settings effects that can't live in a PR, folds the
managed-file registry into the branch, and always returns the tree to the base
branch. New `openFixPr` orchestrator (git via simple-git) and `openOrReusePr`
(Octokit, MSW-tested) in the engine.
