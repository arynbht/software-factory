# @arynbht/factory

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
- ba927e1: Add the composite GitHub Action. A hidden `factory ci` command audits the
  checked-out repo, writes the report to the job summary, and either posts a sticky
  PR comment (failing the job when the gate is red) or maintains a pinned "Factory
  status" issue on scheduled runs (never failing the job), per ADR-0006. The CLI is
  esbuild-bundled with the catalog into `packages/action/dist` (committed), and
  `action.yml` runs it; CI rebuilds the bundle to catch drift.
- 7c9e9eb: Add the evidence workflow. `factory evidence add <control> --url|--file [--note
--reviewer --valid-for]` records an entry in `.factory/evidence.yml` (hashing a
  `--file` with sha256), and the audit warns about evidence expiring within 30 days.
- 0e83bcc: Add phase gates. A gate (`packages/catalog/gates/<phase>.yml`) selects controls by
  id, lane, phase, or minimum severity; `evaluateGate` computes green (all pass /
  n/a / waived), amber (only needs-evidence or skip outstanding), or red (any fail).
  `factory audit --gate <phase>` or `--gate all` prints gate status and exits
  non-zero when a requested gate is red. Ships scaffold/build/harden gates and
  validates gates in `catalog:validate`.
- 645b46e: Add `factory init`: an interactive (`@clack/prompts`) or flag-driven setup that
  writes `.factory/{profile,waivers,evidence}.yml` and `.github/workflows/factory.yml`
  (with the PR + weekly-schedule triggers), then runs the first audit. It refuses to
  overwrite an existing config without `--force`, and `--type` is required in
  non-interactive mode.
- 16b72ba: Add the project profile and applicability. A `.factory/profile.yml` (schema with a
  **constrained** flag set — unknown flags are rejected) describes the project's
  type, stack, phase, risk flags, lane toggles, and severity floor. The engine
  evaluates each control's `applies` predicate (all/any/not over flag/type/stack/
  phase-at-least, plus lane toggles) and marks non-applicable controls with the new
  `n/a` status instead of running them. `factory audit` honours the profile and
  severity floor; `factory profile show|set` reads and edits the profile.
- 281411c: Add `markdown` and `github` report formats to `factory audit --format`. Markdown
  renders a PR-comment/job-summary-friendly table of blocking controls; github emits
  `::error`/`::warning` workflow annotations plus a summary line (used by the Action).
- ab8dd05: Add waivers. A waiver (`.factory/waivers.yml`: control, reason, owner, created,
  expires) turns a non-passing control into the new `waived` status while active;
  an expired waiver has no effect (the control stays failing). `factory waive
<control> --reason --expires [--owner]` records one, the audit reports `waived`
  and warns about waivers expiring within 30 days, and gates treat waived controls
  as satisfied.
- 96e4fa2: Add `factory fix --pr`: apply the plan on a dedicated `factory/<date>-<gate>`
  branch, commit one change per control, push, and open a pull request titled
  `factory: <n> fixes for <gate>` — reusing (and refreshing) the existing open
  factory PR for that branch instead of opening duplicates. Requires a clean
  working tree, skips settings effects that can't live in a PR, folds the
  managed-file registry into the branch, and always returns the tree to the base
  branch. New `openFixPr` orchestrator (git via simple-git) and `openOrReusePr`
  (Octokit, MSW-tested) in the engine.
- 67cfb6e: Add the `factory fix` command: evaluate controls, select the non-passing ones that
  carry a generator, and plan their changes. Dry-run by default (a `+ create` / `~ update`
  / `· skip` / `⚙ would apply` preview that never touches disk); `--write` applies them.
  Honours `--control`, `--gate`, and `--lane` selectors and the profile severity-floor,
  reuses the never-clobber apply engine so a human-owned file is left untouched, and is
  idempotent — a second run reports zero file changes.
- 9b44163: Add the `factory ai <task> [path]` command: runs the audit for gap context, drafts
  the artifact with Claude (via the `claude` generator), and previews it (dry-run
  default), applies it with `--write`, or opens/reuses a PR with `--pr`. Reports the
  model, token usage, and the exact files consulted, and gives clear errors for a
  missing `ANTHROPIC_API_KEY` or an unknown task (listing the available ones).
- a48d87e: Add AI usage accounting. Every `factory ai` call appends a JSON line (date, task,
  model, tokens, estimated USD cost) to `.factory/ai-usage.log` (gitignored), and
  `factory ai usage` summarizes it — totals plus per-task and per-day breakdowns. Cost
  is estimated from a small per-model price table; an unpriced model counts as $0.
  Logging never fails the command.
- a97d22f: Add the Claude Code skill (`packages/catalog/skill/SKILL.md`, exposed via
  `bundledSkillDir`): it teaches an agent in a target repo to run `factory audit`
  instead of guessing, read the gap report, and remediate with `factory fix` or draft
  missing artifacts with `factory ai`, under "Claude drafts, humans sign". `factory
init` now installs it into `.claude/skills/factory/SKILL.md` (never-clobber; init
  doesn't fail if it can't be read), and the action bundle copies `skill/` and folds
  it into the staleness hash.
- c23be6b: Add `factory metrics`: the four DORA keys computed from the GitHub API with no extra
  services — deployment frequency (releases/week), lead time (PR open→merge median),
  change failure rate (merged PRs that are reverts/hotfixes), and time to restore
  (`incident`-labeled issue open→close median) — each with its proxy documented and
  `null` when there isn't enough data. `--window <days>` and `--json` supported. The
  Action also appends a per-lane pass snapshot to `.factory/history.jsonl` on each run
  (hygiene trend); `loadHistory`/`laneCounts` read it back.
- 63354f9: Add `factory audit --all`: audit every repo listed in `~/.config/factory/repos.yml`
  (or `--repos <file>` — a YAML list of paths) and print one combined table (pass /
  fail / needs-evidence / total per repo), marking a missing or erroring repo inline
  and exiting non-zero if any repo has a critical failure. `--json` for the combined
  result.
- 1f823bd: Add `factory status`: infers the project phase (the lowest phase whose gate is not
  green) and lists the blocking controls (fail / needs-evidence) in severity then
  effort order, each tagged with its effort. Shows every defined gate's state and the
  profile's declared phase (a floor, never a ceiling). `--json` for machine output.
  `ControlResult` now carries `effort` so consumers can prioritize by it.

### Patch Changes

- fe0f33c: Dead-code cleanup. Remove the unused taxonomy exports `LaneCode`, `PHASE_BY_KEY`,
  `ProjectType`, `FlagKey`, and `Effort`, and make `PhaseDef` internal (none were
  imported anywhere; `LaneKey`/`LaneDef`/`PhaseKey` stay exported because exported
  consts reference them). Extract a shared `today()` helper in the CLI, replacing
  the `new Date().toISOString().slice(0, 10)` duplicated across the waiver,
  evidence, fix, AI, and CI paths. Add an `assertNever` exhaustiveness guard to the
  `fixSummary` switch in `site.cli.ts` so a future fix type can't silently render
  "undefined" into `docs/catalog/`.
- fe0f33c: Dogfood `ci.actions-pinned-sha`: pin every `uses:` in `ci.yml` and `release.yml`
  to a commit SHA with a version comment (actions/checkout v4.4.0, actions/setup-node
  v4.4.0, pnpm/action-setup v4.3.0, gitleaks/gitleaks-action v2.3.9,
  changesets/action v1.9.0). The factory previously failed its own control; Renovate
  (`helpers:pinGitHubActionDigests`) keeps the pins current. `factory audit --lane
cicd` is now fully green.
- 95417a3: AI now uses the developer's Claude subscription via the Claude Code CLI by
  default, not a metered API key. A new `claudeCliTransport` runs `claude` in
  headless mode (`claude -p --output-format json`, subscription auth); the AI
  client picks it automatically when the `claude` binary is on PATH and falls back
  to the `ANTHROPIC_API_KEY` SDK transport otherwise (`preferApiKey` forces the
  API). The `claude` fix generator only auto-drafts when AI is explicitly
  configured (`ctx.aiEnabled`: an injected transport or an API key), so a plain
  `factory fix`/dry-run never spawns the interactive CLI; deliberate drafting via
  `factory ai` uses the subscription.
- 5431e4b: Fix three engine date/metric correctness bugs: DORA `deploymentFrequencyPerWeek`
  now returns `null` (not `Infinity`/`NaN`) when `windowDays <= 0`, matching the
  other metrics; zone-less datetimes (`2026-11-01T00:00:00`) are parsed as UTC
  instead of the host local timezone so a waiver or evidence date means the same
  instant on a laptop and in CI; and the evidence `valid-for` window is anchored to
  the start of the issue date (new `startOfDayMs`) rather than the end of that day,
  removing the ~1 extra day and making the evidence window symmetric with waiver
  expiry.
- fe0f33c: Keep `factory audit` machine output valid. Previously `--gate` appended
  human-readable, colorized gate lines to stdout and the "waiver/evidence
  expiring" warnings were always written to stdout, so `--json` / `--format
markdown|github` combined with a gate (or an expiring waiver) produced
  unparseable output. Gate results are now folded into the JSON object (a `gates`
  array) and rendered in-format for markdown/github; advisory expiry warnings go
  to stderr for machine formats. `--format table` is unchanged.
- fe0f33c: Four engine robustness fixes. Generator failures are no longer swallowed:
  `planControl`/`planControls` return the changes plus a `GeneratorError[]`, and
  `factory fix` prints each failure instead of silently reporting "nothing to fix".
  `factory status` now applies the profile's `severity-floor` (like audit/ci/ai/fix)
  so it neither infers a phase from nor lists blockers the user chose to ignore,
  and derives the all-green phase from the phase list rather than a hardcoded
  `"operate"`. The `github-setting` protection ruleset now requires one approving
  review (was zero), so the `required-pull-request` control can't report "reviews
  required" while self-merge is allowed. `merge-json` preserves a file's existing
  line ending instead of forcing `\n`, avoiding a mixed-EOL whole-file diff on
  Windows.
- fe0f33c: Honor the merge policy's `.factory-suggested` escape hatch. A `merge` fix that
  targets a file the factory previously wrote but a human has since edited no
  longer re-serializes over those edits; it writes the merged result alongside as
  `<path>.factory-suggested` and reports a `suggest` action so the human can
  reconcile it by hand. First-time merges into a human-authored file (minimal
  structural insertion) are unchanged.
- 4d2db9e: Harden the audit CLI after the M1 review: validate `--format` against
  `table|json` (an unknown value is now rejected, not silently rendered as a
  table); fail fast with a clear message when the audit path is missing or not a
  directory; disable colour for non-TTY output and when `NO_COLOR` is set; and stop
  shipping `.tsbuildinfo` inside published packages. Adds an end-to-end `runAudit`
  integration test (report output, lane filter, `.factory/state.json` contents, and
  exit code) with an offline token override so it needs no network.
- 36a2407: Harden the `factory ci` Action entrypoint after the M2 review: an unknown
  `FACTORY_GATE` now fails closed (was: every PR passed green); a malformed
  profile/waivers/evidence file fails with an error (was: silently ignored); PR
  context is detected by a resolvable PR number rather than only the literal
  `pull_request` event; an amber scheduled gate keeps the status issue open instead
  of closing it; expiring waivers/evidence are listed in the report body; and GitHub
  annotations escape newlines/`%`/`,` so a detector message can't truncate or spoof
  them.
- b7e3ceb: Final M2-review hardening: `factory init` no longer clobbers existing
  `waivers.yml`/`evidence.yml`/`factory.yml` when only the profile is absent (each
  write is guarded, `--force` overrides). Add CLI tests for `profile set`, `waive`,
  `evidence add`, and `audit --gate` (red → exit 1, unknown gate → error), and stop
  hard-coding the catalog size in integration tests. The action build now emits a
  deterministic `SOURCE_SHA256` that CI diffs, so a committed bundle that wasn't
  rebuilt after a source change fails the build.
- d8cf3e7: Add the generator framework and merge policy (ADR-0004) that `factory fix` builds
  on. `.factory/state.json` gains a managed-file hash registry with
  `managedFileUnchanged`; `applyChanges` applies a plan of changes dry-run-by-default,
  never overwriting a human-edited file (a `create` file is written only when absent
  or factory-managed-and-unchanged; a `merge` file writes its already-merged
  contents; effects run only in write mode) and records hashes on write. Adds the
  generator type + registry + `planControls` dispatch (generators themselves land in
  M3.2+). The audit now preserves the managed registry across runs.
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

- edb2260: Engine correctness fixes from the full-repo review:

  - **Windows exec**: `runTool` no longer uses `shell: true` (which split arguments
    containing spaces — e.g. the repo path `…\Software Factory - Dev`, breaking the
    `scorecard` detector). It now resolves the binary via PATH+PATHEXT and runs a
    `.cmd`/`.bat` shim through `cmd.exe` directly, so Node's native argument quoting
    applies and spaces are preserved. A bare, extensionless name is no longer
    mistaken for an executable.
  - **`fix --pr`**: a reused branch with no new changes no longer pushes or rewrites
    the PR to "0 fixes" — it reports an empty result and leaves the existing branch
    untouched.
  - **Determinism**: the template generator's copyright year comes from an injected
    `context.now` instead of `new Date()`, so output is reproducible and testable.
  - **Cross-platform idempotency**: the managed-hash registry and the "already up to
    date" check normalize line endings and a leading BOM, so a factory-written file
    checked out with CRLF (`core.autocrlf=true`, the Windows default) is no longer
    mistaken for a human edit.

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

- 563aea4: Test coverage and cross-platform CI from the full-repo review:

  - **`writeFileAtomic` hardening** (bug found by the new concurrency test + Windows
    CI leg): the temp-file name now uses random bytes instead of pid+time (two
    concurrent writers in one process could generate the same temp name and collide),
    and the final rename retries on a transient Windows EPERM/EACCES; the temp file is
    cleaned up if the rename ultimately fails. Also removes the predictable-temp-name
    weakness flagged in the review.

  - **`runCi()` is now tested end-to-end** (the GitHub Action entrypoint): fail-closed
    on an unknown gate, posts a sticky PR comment and fails on a red gate, maintains
    the status issue on a scheduled run without failing, writes the job summary, and
    warns without failing when the repository is unset — all with the GitHub API
    intercepted (MSW).
  - **`fix --pr` CLI path tested**: opens/reports a PR (via an injected opener seam),
    maps a `FixPrError` (dirty tree, no token/slug) to exit 1.
  - **New unit tests** for `writeFileAtomic` (create/overwrite/nested/concurrent) and
    `resolveOnWindows` (PATHEXT resolution, extensionless-name handling).
  - **Windows CI leg**: the `ci` job now runs on `ubuntu-latest` and `windows-latest`
    (bash shell on both), so the Windows exec/path code actually runs in CI.
  - Strengthened a weak merge assertion (exact content) and added a PR-API error-path
    test.

- 2a0db12: CLI UX polish from the full-repo review:

  - `factory fix` and `factory ci` now list each catalog error (file + message) on an
    invalid catalog, matching `factory audit` instead of printing only a count.
  - `factory profile set flags.<x>`/`lanes.<x>` rejects a non-boolean value instead
    of silently coercing it to `false`.
  - `factory evidence add` reports errors with a `factory evidence add:` prefix and
    unwraps `EvidenceError`, consistent with the other commands.
  - `factory audit` errors when `--json` and a conflicting `--format` are both given
    (`--json` is shorthand for `--format json`).
  - `factory fix --control <id>` help note: it applies regardless of the severity
    floor.
  - `factory fix` "nothing to apply" message is accurate whether controls already
    pass or simply have no generator.

- Updated dependencies [fe0f33c]
- Updated dependencies [95417a3]
- Updated dependencies [5431e4b]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [b947439]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [fe0f33c]
- Updated dependencies [1b932c6]
- Updated dependencies [636822f]
- Updated dependencies [2f52773]
- Updated dependencies [01d4b28]
- Updated dependencies [bc577e0]
- Updated dependencies [25b2f62]
- Updated dependencies [a60f31f]
- Updated dependencies [a156198]
- Updated dependencies [681f6ef]
- Updated dependencies [56991cf]
- Updated dependencies [3257bac]
- Updated dependencies [ba927e1]
- Updated dependencies [7c9e9eb]
- Updated dependencies [0e83bcc]
- Updated dependencies [16b72ba]
- Updated dependencies [ab8dd05]
- Updated dependencies [be6c303]
- Updated dependencies [8581cc7]
- Updated dependencies [2a4bd4d]
- Updated dependencies [96e4fa2]
- Updated dependencies [d8cf3e7]
- Updated dependencies [3b7ca5e]
- Updated dependencies [473e9bc]
- Updated dependencies [d1fb3be]
- Updated dependencies [c59168f]
- Updated dependencies [a48d87e]
- Updated dependencies [abba775]
- Updated dependencies [876bc45]
- Updated dependencies [7e613e2]
- Updated dependencies [a97d22f]
- Updated dependencies [e84788b]
- Updated dependencies [81ce412]
- Updated dependencies [fe0f33c]
- Updated dependencies [c23be6b]
- Updated dependencies [1f823bd]
- Updated dependencies [edb2260]
- Updated dependencies [1f1030b]
- Updated dependencies [869e453]
- Updated dependencies [563aea4]
- Updated dependencies [96bd726]
  - @arynbht/factory-catalog@1.0.0
  - @arynbht/factory-engine@1.0.0
