---
"@arynbht/factory-engine": minor
"@arynbht/factory-catalog": minor
---

Add the `template` generator (Eta) and the scaffold templates it renders. Templates
live in `packages/catalog/templates/<name>/`; files at the root are stack-agnostic,
while `node/` and `python/` subdirs are selected from the profile's stack. Ships
templates for README, LICENSE, CODEOWNERS, CONTRIBUTING, SECURITY, .editorconfig,
.env.example, renovate, lefthook (with gitleaks), commitlint, linter (eslint/ruff),
formatter (prettier), CI workflow (node/python), and changesets — each wired to the
control whose `fix: template` points at it.
