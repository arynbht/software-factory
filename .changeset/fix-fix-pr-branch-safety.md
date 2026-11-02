---
"@arynbht/factory-engine": patch
---

Make `factory fix --pr` always return the working tree to the base branch. A
failed `git push` or PR-creation call used to leave the user checked out on the
`factory/…` branch; the push/open-PR step now runs in a `try`/`finally` that
restores the base branch on any failure. Also refuse to run on a detached HEAD
(which reported `base: "HEAD"` and produced a 422 that stranded the branch).
