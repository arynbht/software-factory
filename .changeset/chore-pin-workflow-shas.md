---
"@arynbht/factory": patch
---

Dogfood `ci.actions-pinned-sha`: pin every `uses:` in `ci.yml` and `release.yml`
to a commit SHA with a version comment (actions/checkout v4.4.0, actions/setup-node
v4.4.0, pnpm/action-setup v4.3.0, gitleaks/gitleaks-action v2.3.9,
changesets/action v1.9.0). The factory previously failed its own control; Renovate
(`helpers:pinGitHubActionDigests`) keeps the pins current. `factory audit --lane
cicd` is now fully green.
