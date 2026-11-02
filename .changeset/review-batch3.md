---
"@arynbht/factory-engine": patch
"@arynbht/factory-catalog": patch
"@arynbht/factory": patch
---

Security hardening from the full-repo review:

- **Comment-injection fix**: `.factory/waivers.yml` and `.factory/evidence.yml`
  `control:` values are now validated against the control-id shape at load time, so
  an arbitrary string (Markdown/link payload) can't be smuggled into the PR/issue
  comment the Action posts.
- **Repo-slug host anchoring**: `parseRepoSlug` now requires the host to be exactly
  `github.com` at a host boundary, rejecting look-alikes like `evilgithub.com/...`
  and `github.com.evil.com/...` that could have directed token-bearing API calls at
  an attacker-chosen repo.
- **Least-privilege workflows**: `factory.yml` (repo + scaffolded) now splits by
  trigger — pull-request runs get `pull-requests: write` only, scheduled/push runs
  get `issues: write` only — and adds a `concurrency` group so overlapping runs
  can't race the sticky comment / status issue. `release.yml` gets a concurrency
  guard too.
- **Secret-scan backstop**: CI runs a full-history gitleaks scan (the pre-commit
  hook can be bypassed with `--no-verify`).
- **Docs**: SECURITY.md now documents pinning the committed Action by commit SHA
  (the `SOURCE_SHA256` guard is CI-only, not a consumer runtime check).
