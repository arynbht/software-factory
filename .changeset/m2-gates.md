---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Add phase gates. A gate (`packages/catalog/gates/<phase>.yml`) selects controls by
id, lane, phase, or minimum severity; `evaluateGate` computes green (all pass /
n/a / waived), amber (only needs-evidence or skip outstanding), or red (any fail).
`factory audit --gate <phase>` or `--gate all` prints gate status and exits
non-zero when a requested gate is red. Ships scaffold/build/harden gates and
validates gates in `catalog:validate`.
