# @arynbht/factory-catalog

## 1.0.0

### Major Changes

- 96bd726: 1.0.0 — first stable release.

  Software Factory audits a GitHub repository against a data-driven catalog of controls,
  reports the gaps by phase and discipline, and generates the fixes as pull requests.
  This is the first version with a committed public API across all clients.

  - **Engine** — profile resolution and applicability, ~40 detectors (file, YAML, and
    GitHub API), phase gates, template/merge/`claude` generators, the Claude API +
    Claude Code CLI transports, and the GitHub API layer with caching.
  - **CLI** (`factory`) — `init`, `audit` (+ `--all`), `fix` (dry-run diff, apply, open
    PR), `ai <task>` (20 prompt tasks incl. changelog), `status` (phase inference),
    `metrics` (DORA + history), `waive`, `evidence`, `profile`.
  - **Action** — runs the audit in CI, comments the gap summary on PRs, fails the job
    when the phase gate is red.
  - **Catalog** — 99 controls across 14 lanes, each with references and a rationale;
    gates for all nine phases; 20 AI prompt templates.
  - **Desktop** — Electron shell (Repos → audit → scorecard, profile, gates, fix, AI,
    docs, settings) with device-flow sign-in, a strict security baseline, Playwright
    e2e, and electron-builder packaging with Electron fuses.

### Minor Changes

- 1b932c6: Add the `factory audit` CLI command — the first user-facing surface. It loads the
  bundled catalog, evaluates every control against a repo (bounded-concurrency
  `evaluateControls`), and prints a coloured table grouped by lane with a summary
  line, or `--json`. Supports `--lane`, `--token`, and `--no-color`, writes
  `.factory/state.json`, and exits non-zero when a critical control fails. Catalog
  gains `loadBundledCatalog`; engine gains `evaluateControls` and a `title` on
  `ControlResult`.
- 2f52773: Add the control schema (zod), taxonomy (14 lanes, 9 phases, 4 severities), the
  catalog loader, and the `catalog:validate` script with a generated JSON Schema
  for editor autocomplete.
- 01d4b28: Add the first 40 controls across the hygiene, development, CI/CD, security, and
  testing lanes — each with a detector, at least one cited reference, and a
  rationale. `factory audit` now produces a real lane-by-lane scorecard.
- 0e83bcc: Add phase gates. A gate (`packages/catalog/gates/<phase>.yml`) selects controls by
  id, lane, phase, or minimum severity; `evaluateGate` computes green (all pass /
  n/a / waived), amber (only needs-evidence or skip outstanding), or red (any fail).
  `factory audit --gate <phase>` or `--gate all` prints gate status and exits
  non-zero when a requested gate is red. Ships scaffold/build/harden gates and
  validates gates in `catalog:validate`.
- 16b72ba: Add the project profile and applicability. A `.factory/profile.yml` (schema with a
  **constrained** flag set — unknown flags are rejected) describes the project's
  type, stack, phase, risk flags, lane toggles, and severity floor. The engine
  evaluates each control's `applies` predicate (all/any/not over flag/type/stack/
  phase-at-least, plus lane toggles) and marks non-applicable controls with the new
  `n/a` status instead of running them. `factory audit` honours the profile and
  severity floor; `factory profile show|set` reads and edits the profile.
- ab8dd05: Add waivers. A waiver (`.factory/waivers.yml`: control, reason, owner, created,
  expires) turns a non-passing control into the new `waived` status while active;
  an expired waiver has no effect (the control stays failing). `factory waive
<control> --reason --expires [--owner]` records one, the audit reports `waived`
  and warns about waivers expiring within 30 days, and gates treat waived controls
  as satisfied.
- d1fb3be: Add the `template` generator (Eta) and the scaffold templates it renders. Templates
  live in `packages/catalog/templates/<name>/`; files at the root are stack-agnostic,
  while `node/` and `python/` subdirs are selected from the profile's stack. Ships
  templates for README, LICENSE, CODEOWNERS, CONTRIBUTING, SECURITY, .editorconfig,
  .env.example, renovate, lefthook (with gitleaks), commitlint, linter (eslint/ruff),
  formatter (prettier), CI workflow (node/python), and changesets — each wired to the
  control whose `fix: template` points at it.
- abba775: Add the `claude` generator framework. Prompt templates live at
  `packages/catalog/prompts/<task>.md` (YAML front-matter: `task`, `output`, `globs`,
  `control`, `checklist`; body = the system prompt), loaded via `bundledPromptsDir` /
  `loadPrompt`. `generateArtifact(ctx, task, …)` packs secret-guarded context, calls
  the model, and renders the file with the review convention — a provenance header
  (generated-by / date / model / files-consulted / empty `reviewed-by:`) plus the
  reviewer checklist, both as Markdown comment blocks ("Claude drafts, humans sign").
  The `claude` fix type is now wired into the generator registry (via `context.ai()`),
  and the first task (`explain-gaps`) ships with a fixture test driven by a recorded
  response. The action bundle copies `prompts/` and folds it into the staleness hash.
- 7e613e2: Add the AI task prompt templates (invokable via `factory ai <task>`): `brief`,
  `stories`, `adr`, `c4`, `threat-model`, `runbook`, `test-scaffold`,
  `license-summary` (plus `explain-gaps`). Each pins its output path, context globs,
  and a reviewer checklist, and instructs the model to mark unknowns as `TODO:` rather
  than invent facts. `sec.threat-model` is control-wired to the `threat-model` task;
  the rest are standalone until M6 adds their controls. The `claude` generator now
  degrades to no change when there's no API key, so a mixed `factory fix` run never
  aborts on an AI control — AI drafts are produced on demand via `factory ai`, which
  surfaces the missing key. A drift test loads and validates every bundled prompt.
  (`changelog` is deferred — it needs git-log input the context packer doesn't provide
  yet.)
- a97d22f: Add the Claude Code skill (`packages/catalog/skill/SKILL.md`, exposed via
  `bundledSkillDir`): it teaches an agent in a target repo to run `factory audit`
  instead of guessing, read the gap report, and remediate with `factory fix` or draft
  missing artifacts with `factory ai`, under "Claude drafts, humans sign". `factory
init` now installs it into `.claude/skills/factory/SKILL.md` (never-clobber; init
  doesn't fail if it can't be read), and the action bundle copies `skill/` and folds
  it into the staleness hash.
- fe0f33c: Complete the M6 control-catalog breadth and fix phase inference.

  - Add the remaining lanes so all 14 are covered with ≥6 controls each:
    accessibility, legal, ux, and product (plus the previously-staged cloud, data,
    documentation, observability, performance lanes), and two more testing
    controls. 98 controls across 9 phase gates.
  - Add the `risk-register` and `launch-checklist` templates and nine Claude prompt
    templates (build-vs-buy, nfrs, out-of-scope, data-inventory, retention-schedule,
    dsar-process, privacy-policy, copy-guidelines, accessibility-statement) so the
    newly-wired `template`/`claude` fixes resolve instead of silently no-opping.
  - `factory status` no longer treats a phase gate that selects zero controls as a
    blocker: an empty gate is "undefined for this profile", not amber, so it never
    pins the inferred phase. With the early phases now populated, an empty repo
    correctly infers `discovery`.

### Patch Changes

- fe0f33c: Dead-code cleanup. Remove the unused taxonomy exports `LaneCode`, `PHASE_BY_KEY`,
  `ProjectType`, `FlagKey`, and `Effort`, and make `PhaseDef` internal (none were
  imported anywhere; `LaneKey`/`LaneDef`/`PhaseKey` stay exported because exported
  consts reference them). Extract a shared `today()` helper in the CLI, replacing
  the `new Date().toISOString().slice(0, 10)` duplicated across the waiver,
  evidence, fix, AI, and CI paths. Add an `assertNever` exhaustiveness guard to the
  `fixSummary` switch in `site.cli.ts` so a future fix type can't silently render
  "undefined" into `docs/catalog/`.
- b947439: Stop the factory's own `factory.yml` from satisfying `ci.workflow.present`, so a
  fresh repo actually gets a real CI workflow. The `file-exists` detector gains an
  optional `exclude` glob (paths that do NOT count as a match), and
  `ci.workflow.present` now excludes `.github/workflows/factory.yml`. Previously a
  repo scaffolded by `init` ended up with `factory.yml` but no test/lint/build
  workflow, because the control passed on `factory.yml` alone and `factory fix`
  never fired the `ci-workflow` template (and the `ci.concurrency` /
  `ci.workflow-permissions` merges then had no `ci.yml` target). Closes #62.
- fe0f33c: Honor the `exists` option in the `file-json-path` / `file-yaml-path` detectors.
  It was declared in the schema but never read, so `exists: false` (assert the
  path is absent) silently passed exactly when the path was present — the opposite
  of its intent. `exists: false` now passes only when the path is absent in every
  matched file; `exists: true` / omitted keeps the existing "path must exist"
  behavior. The schema description is updated to match.
- a156198: Tighten controls flagged by the M1 review to remove false passes:
  `test.runner.configured` now requires a real test runner (not npm's "no test
  specified" placeholder or a dependency named `test`); `ci.dependency-caching`
  drops the greedy `setup-node[\s\S]*cache` match; `dev.conventional-commits` no
  longer matches an incidentally-named package.json dependency; `ci.runs-on-push`
  and `sec.scorecard.score` titles/rationales no longer overclaim; and
  `dev.precommit-hooks` cites a relevant reference. Adds an engine test that loads
  the bundled catalog and compiles every `file-matches` pattern, so a malformed
  pattern fails CI instead of silently skipping at audit time.
- be6c303: Harden the engine after the M2 review: waiver/evidence expiry now uses an inclusive
  end-of-day for bare `YYYY-MM-DD` dates (they no longer expire ~a day early); a gate
  whose selector matches nothing is `amber`, not silently `green`; `loadEvidence`
  throws on a malformed file instead of silently returning none; config writes
  (`addWaiver`/`addEvidence`/`saveProfile`) are atomic (temp + rename); the CI
  comment/status-issue upserts paginate and reopen a closed status issue instead of
  duplicating; and waiver `expires`/`created` are validated as ISO dates.
- 8581cc7: Add the `command` generator: an effect that runs an installer in the repo root on
  `--write` (the dry-run shows the exact command first), reusing the tool runner so a
  missing tool or non-zero exit is recorded as a failure rather than aborting the run.
  Wires `repo.lockfile.present` to `npm install`. All five M3 generators are now
  implemented.
- 2a4bd4d: M3 dogfood fixes. Make the `command` fix runner work on Windows: `runTool` now
  resolves a bare command via `PATH`+`PATHEXT` (so a missing tool is still a clean
  `ToolNotFoundError`) and runs through a shell, so `.cmd`/`.bat` shims like `npm`
  execute instead of failing with "not installed". Add a stack-aware `toolchain`
  template (`.nvmrc` for node, `.python-version` for python) and wire it as the fix
  for `repo.toolchain-pinned`, which previously had no generator and so left the
  scaffold gate unreachable. See docs/audit-notes.md for the full dogfood log.
- 473e9bc: Add the `merge-json` and `merge-yaml` generators: they set a dot/bracket path to a
  value inside an existing file with a minimal, formatting- and comment-preserving
  edit (jsonc-parser `modify` for JSON; the `yaml` Document round-trip for YAML),
  no-op when the value already matches, and create the file if absent. Gives the
  `ci.workflow-permissions`/`ci.concurrency` controls actionable values. (CI-step
  _append_ fixes, which need more than a path-set, remain no-ops for now.)
- 81ce412: Add `pnpm catalog:site`: render every control to browsable Markdown under
  `docs/catalog/` — one page per lane (id, title, phase/severity/effort,
  detector/fix summary, rationale, references) plus an index with per-lane counts.
  CI checks the output is current (regenerate + `git diff`), so the catalog is always
  readable on GitHub without drifting from the YAML.
- 1f1030b: Catalog safety fixes from the full-repo review — `factory fix` can no longer
  corrupt a repo it doesn't fit:

  - **Merges never fabricate an absent file.** `merge-json`/`merge-yaml` now edit
    only an existing target and no-op when it's missing. This stops `fix` from
    writing a Node-only `package.json` into a Python/Go repo (`test.runner.configured`)
    and from fabricating an incomplete, invalid `ci.yml`/`release.yml` when the
    detector found a differently-named workflow (`ci.workflow-permissions`,
    `ci.concurrency`, `sec.sbom.ci`). Creating structured files is a `template` fix's
    job.
  - **No misleading no-op fixes.** Removed the 8 `merge-yaml` fixes that had no
    `value` (they produced no change and would have clobbered the `jobs.ci.steps`
    array); those controls are now detection-only.
  - **`catalog:validate` rejects value-less merge fixes** so they can't return.
  - **Dropped the unsafe `npm install` fix** from `repo.lockfile.present`: the
    package manager can't be inferred from the detector, and `npm install` writes the
    wrong lockfile for pnpm/yarn/cargo/poetry/go repos. The control is detection-only.

- 869e453: Security hardening from the full-repo review:

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
