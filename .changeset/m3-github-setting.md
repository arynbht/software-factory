---
"@arynbht/factory-engine": minor
---

Add the `github-setting` generator: an effect generator that applies repo settings
via the API — a ruleset protecting the default branch (idempotent by name),
secret-scanning push protection, Dependabot security updates, and vulnerability
alerts. The apply engine now records a failing effect (e.g. missing admin scope)
instead of aborting the whole run.
