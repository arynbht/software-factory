# Audit notes

A running log of dogfooding `factory audit` on real repositories: every false
positive, its cause, and whether it was fixed in a detector, a control, or is
expected. Add an entry (and ideally a fixture) each time a real repo exposes a
problem.

## 2026-11-01 — Milestone 1 dogfood on the factory repo

First end-to-end run of `factory audit .` against the factory repo itself, with
all 40 M1 controls.

**Result:** `28 pass, 10 fail, 1 need evidence, 1 skip (40 controls)` in ~1.1s
(well under the 30s target).

### Fixed during this pass

| Control                                              | Symptom                                          | Fix                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repo.branch-protection`, `dev.code-review-required` | Reported `fail` even though `main` is protected. | The `github-api` detector only read **classic** branch protection (`GET …/branches/{b}/protection`, which 404s here). `main` is protected by a **repository ruleset**. The detector now also reads `GET …/rules/branches/{b}` (needs only read access) and passes when either classic protection or ruleset rules apply. |

### False positives pending Milestone 2

| Control            | Why it is a false positive                                                                                                                                                                         | Resolution                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `test.e2e.present` | The factory is not public-facing, so E2E tests should not apply. The control carries `applies: { flag: public-facing }`, but applicability is not evaluated until M2, so in M1 every control runs. | Will show `n/a` once M2 evaluates `applies` against the profile. |

### Genuine gaps (not false positives)

These failures are real and are expected to be closed by later milestones
(several are exactly what the factory's own generators will fix in M3):

- `ci.actions-pinned-sha` — actions are pinned by tag (`@v4`), not SHA. Renovate
  is configured with `helpers:pinGitHubActionDigests` and will convert these.
- `dev.env-example` — no `.env.example` yet (the project has no runtime env vars).
- `sec.secret-scanning.ci` — gitleaks runs in the pre-commit hook but not yet as
  a CI job.
- `sec.dependency-scan.ci`, `sec.sast.ci`, `sec.sbom.ci` — no OSV/CodeQL/SBOM
  steps yet; these land with the hardening work (and M3 generators).
- `sec.dependabot-security-updates`, `sec.vulnerability-alerts` — not yet enabled
  in repo settings.
- `test.coverage-config` — coverage reporting was deliberately deferred in M0.

### Correct non-pass results (working as intended)

- `sec.scorecard.score` → **skip**: OpenSSF Scorecard is not installed locally, so
  the `scorecard` detector correctly skips rather than fails.
- `sec.threat-model` → **needs-evidence**: a `manual` control with no evidence in
  `.factory/evidence.yml`.

### Known limitations logged for later

- **Auditing a non-git subdirectory**: `buildContext` resolves the GitHub slug
  from the git remote, which for a path nested inside another repo resolves to the
  _enclosing_ repo. Real target repos are standalone clones, so this does not
  affect normal use, but it means `github-api` checks are not meaningful when
  auditing, say, a fixture directory inside this repo. Running without a token
  makes those checks skip cleanly.
- **Multi-repo dogfooding**: per the weekly rhythm, `factory audit` should be run
  against several standalone real repos. The engine is additionally exercised
  against the `empty`, `node-minimal`, and `node-complete` fixture repos in the
  unit tests, covering pass/fail/skip for every detector on different repo shapes.
