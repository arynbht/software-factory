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

## 2026-11-01 — Milestone 3 dogfood: `factory fix` on a fresh repo

First end-to-end run of the M3 remediation flow — `factory init` then
`factory fix --write`/`--pr` — on a throwaway Node repo, reviewing the output as
if a stranger had sent the PR. Validated against the M3 Definition of Done.

### DoD results

- **(1) `init && fix --write` → green scaffold gate.** _Met, modulo one
  online-only control._ After `fix --write`, **every local scaffold-phase
  control passes**. The only non-pass is `repo.branch-protection`, a `github-api`
  setting that **skips** offline (no token) and so keeps the gate `amber` rather
  than `red`. With a token (as in CI/the scheduled run) the `github-setting`
  generator applies the ruleset and it passes → `green`.
- **(2) `fix` on a hand-edited `ci.yml` adds the missing piece without touching
  other lines.** _Met for key-level merges, with a minor caveat._ Removing the
  `concurrency` block from a hand-edited `ci.yml` (with a custom top comment) and
  running `fix --control ci.concurrency --write` re-added **only** the
  `concurrency:` block; the comment, `jobs`, `steps`, and `permissions` were all
  preserved. Caveat below.
- **(3) Running `fix` twice produces no second diff.** _Fully met._ A second
  `fix --write` on a committed scaffold reports `0 file changes applied` and
  leaves a clean working tree (the managed-hash registry in `.factory/state.json`
  makes the apply idempotent).

### Fixed during this pass

| Area                    | Symptom                                                                                                                                                  | Fix                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool runner (Windows)   | The `command` fix `npm install` failed with `"npm" is not installed` on Windows, even with npm on PATH. `execFile` cannot launch a `.cmd` shim directly. | `runTool` now resolves the binary via `PATH`+`PATHEXT` on Windows (so "missing" is still a clean `ToolNotFoundError`) and runs through a shell so `.cmd`/`.bat` shims execute. |
| `repo.toolchain-pinned` | A **scaffold-phase** control with **no `fix`** — so `fix` could never make the scaffold gate green.                                                      | Added a stack-aware `toolchain` template (`.nvmrc` → `22` for node, `.python-version` → `3.12` for python) and wired `fix: { type: template, template: toolchain }`.           |

### Findings logged for follow-up

- **Most `merge-yaml` CI-content fixes are no-ops.** 8 of 10 `merge-yaml`
  controls (`ci.dependency-caching`, `ci.actions-pinned-sha`, `dev.linter.in-ci`,
  `sec.dependency-scan.ci`, `sec.sast.ci`, `sec.sbom.ci`, `sec.secret-scanning.ci`,
  `test.runner.in-ci`) have **no `value`**, so the generator returns no change and
  the advertised `fix` does nothing. They also target `jobs.ci.steps` — an
  **array** — but the generator uses `setIn(path, value)`, which _replaces_ a key
  rather than appending a step. Correctly auto-fixing these needs
  append-if-missing array-merge semantics plus per-step fragments. Today the
  remediation for CI content is the complete `ci-workflow` template (fresh repos);
  an existing repo missing one step is not auto-fixed. → follow-up issue.
- **YAML merge can reformat untouched lines.** The `yaml` round-trip reformats
  flow collections (`branches: [main]` → `branches: [ main ]`) and strips a
  leading BOM, so a `merge-yaml` fix can introduce small cosmetic diffs away from
  the change. Structural content and comments are preserved. → minor follow-up.
- **`npm install` with no `package.json` exits non-zero** yet still writes
  `package-lock.json` (so `repo.lockfile.present` then passes). The effect is
  reported as "failed" even though the lockfile was produced — a false alarm in
  that one case. Minor.

## 2026-11-01 — Milestone 4 dogfood: Claude integration

The M4 AI pipeline (client → context packer → `claude` generator → `factory ai`
→ usage log → skill) is covered end-to-end by **recorded-response fixtures** so the
whole flow is tested without a network call or a key. The parts that need a live
`ANTHROPIC_API_KEY` are the human's final check (below).

### Validated offline (no key)

- `factory init` installs the Claude Code skill at `.claude/skills/factory/SKILL.md`
  alongside `.factory/` and the workflow.
- `factory ai explain-gaps` with no key → `factory ai: no Anthropic API key. Set
ANTHROPIC_API_KEY and retry.` and exit 1 (clean, no stack trace).
- `factory ai bogus-task` → lists the nine available tasks (`adr, brief, c4,
explain-gaps, license-summary, runbook, stories, test-scaffold, threat-model`),
  confirming every prompt is bundled and discoverable.
- `factory ai usage` on a fresh repo → `No AI usage recorded yet.`
- **Secret guard** (the key safety property): a unit test proves a `.env` and a
  secret-content file are excluded from the packed context even under a greedy
  `**/*` glob, and the secret values never appear in what would be sent.

### DoD items requiring a live key (human check)

These can't run in this environment (no `ANTHROPIC_API_KEY`); run them locally to
close the loop:

1. `factory ai explain-gaps` produces a sendable narrative on a half-built repo.
2. `factory ai threat-model --pr` opens a PR with a STRIDE table whose rows
   reference real components.
3. Claude Code, with the installed skill, answers "what's left?" by running the
   audit.

The deterministic machinery those depend on (prompt loading, context assembly with
the gap report, client call, generated-file header/checklist, apply/`--write`/`--pr`,
usage logging) is all fixture-tested, so the live check is about output quality, not
plumbing.

### Follow-ups opened during M4

- `changelog` task deferred — it needs git-log (commits since last tag) as context,
  which the packer doesn't assemble yet. → follow-up.
- Eight of the nine task→control wirings wait on M6 catalog breadth; only
  `sec.threat-model` is control-wired today (the rest run as standalone
  `factory ai <task>`).
