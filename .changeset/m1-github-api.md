---
"@arynbht/factory-engine": minor
---

Add the `github-api` detector: a cached Octokit client in the audit context
(repo slug auto-detected via git remote or injected), token resolution
(`--token` / `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token`), and named checks
(branch protection, required PR/status checks, secret scanning + push protection,
Dependabot security updates, vulnerability alerts, default branch, visibility,
Actions permissions). Missing-permission responses become a clear `skip` naming
the scope needed. Tested against MSW-recorded responses, so CI needs no token.
