---
"@arynbht/factory-runtime": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-catalog": minor
"@arynbht/factory": minor
---

Factory v2 step 4: judge tier 2. `factory review` (local, or `--pr <n>` to post one PR
review) and `factory judge --review` (tier 1, then tier 2 unless tier 1 needs a human).
Only defects, contract breaches and unmet acceptance criteria block; everything else
is a suggestion. Each blocking finding is re-checked in a fresh context and downgraded
without a concrete reproduction. Two rounds, then needs-human. The model sees only the
packed diff (no sensitive paths, secret-shaped or generated files; source first) and
the base's AGENTS.md/CONSTRAINTS.md. The Claude CLI transport now runs locked down: no
tools, safe mode, empty working directory. Judge model from profile `ai.judge_model`.
