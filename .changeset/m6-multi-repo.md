---
"@arynbht/factory": minor
---

Add `factory audit --all`: audit every repo listed in `~/.config/factory/repos.yml`
(or `--repos <file>` — a YAML list of paths) and print one combined table (pass /
fail / needs-evidence / total per repo), marking a missing or erroring repo inline
and exiting non-zero if any repo has a critical failure. `--json` for the combined
result.
