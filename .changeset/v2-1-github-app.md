---
"@arynbht/factory": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-runtime": patch
---

The factory's GitHub App (ADR-0007, spec v2.1 §14).

- `factory app register [--org <org>]` creates the App from its manifest in one
  click: a local page posts the manifest to GitHub, GitHub sends you back with a
  one-time code, and the App's ID, private key and secrets are kept in the
  factory's config directory (secrets readable by you only). It asks for exactly
  ADR-0007's permissions, with no webhook.
- `factory app status` shows whether the factory acts as the App in a repo;
  `factory app token` prints an installation token for scripts and CI.
- A new `githubToken(repo)` picks how the factory reaches GitHub: an explicit
  token, then `GITHUB_TOKEN`/`GH_TOKEN`, then the App when it's installed on the
  repo, then `gh auth`. `factory review --pr`, evidence uploads, `task ship` and
  `task close` use it, so with the App their reviews, evidence and PRs come from
  the factory. This also fixes `task ship` and `task close` outside tests: they
  built their GitHub client with no token, so they always failed.
- `factory doctor` says whether the factory reaches GitHub as its App or as you.
