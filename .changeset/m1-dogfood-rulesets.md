---
"@arynbht/factory-engine": patch
---

Fix the `branch-protection`, `required-pull-request`, and `required-status-checks`
github-api checks to recognise repository rulesets, not only classic branch
protection. The rules endpoint needs just read access, so these checks no longer
false-fail (or need admin) on repos protected by a ruleset.
