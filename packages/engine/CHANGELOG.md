# @arynbht/factory-engine

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

- 95417a3: AI now uses the developer's Claude subscription via the Claude Code CLI by
  default, not a metered API key. A new `claudeCliTransport` runs `claude` in
  headless mode (`claude -p --output-format json`, subscription auth); the AI
  client picks it automatically when the `claude` binary is on PATH and falls back
  to the `ANTHROPIC_API_KEY` SDK transport otherwise (`preferApiKey` forces the
  API). The `claude` fix generator only auto-drafts when AI is explicitly
  configured (`ctx.aiEnabled`: an injected transport or an API key), so a plain
  `factory fix`/dry-run never spawns the interactive CLI; deliberate drafting via
  `factory ai` uses the subscription.
- 1b932c6: Add the `factory audit` CLI command — the first user-facing surface. It loads the
  bundled catalog, evaluates every control against a repo (bounded-concurrency
  `evaluateControls`), and prints a coloured table grouped by lane with a summary
  line, or `--json`. Supports `--lane`, `--token`, and `--no-color`, writes
  `.factory/state.json`, and exits non-zero when a critical control fails. Catalog
  gains `loadBundledCatalog`; engine gains `evaluateControls` and a `title` on
  `ControlResult`.
- 636822f: Add the `command` and `scorecard` detectors. `command` runs a tool in the repo
  root and checks its exit code or a `jsonPath` in its JSON stdout; a missing tool
  is a clean skip. `scorecard` runs OpenSSF Scorecard and asserts a named check
  meets a minimum score. Completes all seven M1 detector types.
- bc577e0: Add the audit context (`buildContext` with fs + glob helpers), the detector
  framework (registry + dispatch with skip-on-unimplemented/error), the
  `file-exists` and `file-matches` detectors, and `evaluateControl` which
  aggregates a control's detectors into a single status.
- a60f31f: Add the `github-api` detector: a cached Octokit client in the audit context
  (repo slug auto-detected via git remote or injected), token resolution
  (`--token` / `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token`), and named checks
  (branch protection, required PR/status checks, secret scanning + push protection,
  Dependabot security updates, vulnerability alerts, default branch, visibility,
  Actions permissions). Missing-permission responses become a clear `skip` naming
  the scope needed. Tested against MSW-recorded responses, so CI needs no token.
- 56991cf: Add the evidence stub and `manual` control handling. `loadEvidence` reads
  `.factory/evidence.yml` (cached on the context) and `findValidEvidence` honours
  `valid-for` expiry. `evaluateControl` now satisfies a `manual` detector from a
  valid, unexpired evidence entry and otherwise reports the fourth control status,
  `needs-evidence`.
- 3257bac: Add the `file-json-path` and `file-yaml-path` detectors: assert that a dot/bracket
  path exists or equals a value inside JSON (JSONC-tolerant) or YAML files, across a
  glob of files. Includes shared path navigation and structural deep-equality.
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
- 8581cc7: Add the `command` generator: an effect that runs an installer in the repo root on
  `--write` (the dry-run shows the exact command first), reusing the tool runner so a
  missing tool or non-zero exit is recorded as a failure rather than aborting the run.
  Wires `repo.lockfile.present` to `npm install`. All five M3 generators are now
  implemented.
- 96e4fa2: Add `factory fix --pr`: apply the plan on a dedicated `factory/<date>-<gate>`
  branch, commit one change per control, push, and open a pull request titled
  `factory: <n> fixes for <gate>` — reusing (and refreshing) the existing open
  factory PR for that branch instead of opening duplicates. Requires a clean
  working tree, skips settings effects that can't live in a PR, folds the
  managed-file registry into the branch, and always returns the tree to the base
  branch. New `openFixPr` orchestrator (git via simple-git) and `openOrReusePr`
  (Octokit, MSW-tested) in the engine.
- d8cf3e7: Add the generator framework and merge policy (ADR-0004) that `factory fix` builds
  on. `.factory/state.json` gains a managed-file hash registry with
  `managedFileUnchanged`; `applyChanges` applies a plan of changes dry-run-by-default,
  never overwriting a human-edited file (a `create` file is written only when absent
  or factory-managed-and-unchanged; a `merge` file writes its already-merged
  contents; effects run only in write mode) and records hashes on write. Adds the
  generator type + registry + `planControls` dispatch (generators themselves land in
  M3.2+). The audit now preserves the managed registry across runs.
- 3b7ca5e: Add the `github-setting` generator: an effect generator that applies repo settings
  via the API — a ruleset protecting the default branch (idempotent by name),
  secret-scanning push protection, Dependabot security updates, and vulnerability
  alerts. The apply engine now records a failing effect (e.g. missing admin scope)
  instead of aborting the whole run.
- 473e9bc: Add the `merge-json` and `merge-yaml` generators: they set a dot/bracket path to a
  value inside an existing file with a minimal, formatting- and comment-preserving
  edit (jsonc-parser `modify` for JSON; the `yaml` Document round-trip for YAML),
  no-op when the value already matches, and create the file if absent. Gives the
  `ci.workflow-permissions`/`ci.concurrency` controls actionable values. (CI-step
  _append_ fixes, which need more than a path-set, remain no-ops for now.)
- d1fb3be: Add the `template` generator (Eta) and the scaffold templates it renders. Templates
  live in `packages/catalog/templates/<name>/`; files at the root are stack-agnostic,
  while `node/` and `python/` subdirs are selected from the profile's stack. Ships
  templates for README, LICENSE, CODEOWNERS, CONTRIBUTING, SECURITY, .editorconfig,
  .env.example, renovate, lefthook (with gitleaks), commitlint, linter (eslint/ruff),
  formatter (prettier), CI workflow (node/python), and changesets — each wired to the
  control whose `fix: template` points at it.
- c59168f: Add the Anthropic SDK wrapper (`ai/client.ts`): `createAiClient().complete()` over
  the Messages API with `resolveAnthropicKey`, model pinning (configurable default),
  and client-layer retry-with-backoff + timeout so transient 429/5xx/timeouts are
  handled deterministically. The real SDK is loaded lazily (only on an actual call)
  and the transport is injectable, so non-AI paths stay light and tests never hit the
  network. The key is read from `ANTHROPIC_API_KEY` and never stored or logged.
- a48d87e: Add AI usage accounting. Every `factory ai` call appends a JSON line (date, task,
  model, tokens, estimated USD cost) to `.factory/ai-usage.log` (gitignored), and
  `factory ai usage` summarizes it — totals plus per-task and per-day breakdowns. Cost
  is estimated from a small per-model price table; an unpriced model counts as $0.
  Logging never fails the command.
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
- 876bc45: Add the AI context packer (`ai/context.ts`): assembles the profile, the gap report,
  the control's rationale + references, and a size-capped selection of task-glob'd repo
  files into one context block, and returns the exact list of files included (for the
  PR description). Secrets are kept out by two layers (`ai/redact.ts`): a path denylist
  (`.env*`, `*.pem`/`*.key`, `id_rsa`, `.npmrc`, `secrets.*`, …) and a content scan
  (private keys, AWS/GitHub/Slack/Anthropic/Google key shapes, and generic
  `key = "value"` assignments). A file that matches either guard is skipped, never
  sent.
- c23be6b: Add `factory metrics`: the four DORA keys computed from the GitHub API with no extra
  services — deployment frequency (releases/week), lead time (PR open→merge median),
  change failure rate (merged PRs that are reverts/hotfixes), and time to restore
  (`incident`-labeled issue open→close median) — each with its proxy documented and
  `null` when there isn't enough data. `--window <days>` and `--json` supported. The
  Action also appends a per-lane pass snapshot to `.factory/history.jsonl` on each run
  (hygiene trend); `loadHistory`/`laneCounts` read it back.
- 1f823bd: Add `factory status`: infers the project phase (the lowest phase whose gate is not
  green) and lists the blocking controls (fail / needs-evidence) in severity then
  effort order, each tagged with its effort. Shows every defined gate's state and the
  profile's declared phase (a floor, never a ceiling). `--json` for machine output.
  `ControlResult` now carries `effort` so consumers can prioritize by it.

### Patch Changes

- 5431e4b: Fix three engine date/metric correctness bugs: DORA `deploymentFrequencyPerWeek`
  now returns `null` (not `Infinity`/`NaN`) when `windowDays <= 0`, matching the
  other metrics; zone-less datetimes (`2026-11-01T00:00:00`) are parsed as UTC
  instead of the host local timezone so a waiver or evidence date means the same
  instant on a laptop and in CI; and the evidence `valid-for` window is anchored to
  the start of the issue date (new `startOfDayMs`) rather than the end of that day,
  removing the ~1 extra day and making the evidence window symmetric with waiver
  expiry.
- fe0f33c: Broaden the AI-context secret guard. The content scan now also catches Stripe
  keys (`sk_live_`/`rk_live_`), JWTs, service-account/cloud-credential JSON,
  Azure `AccountKey=` connection strings, database URLs with an inline password,
  and unquoted `key=value` secret assignments. The path denylist gains certificate
  and credential-store extensions (`.crt/.cer/.der/.p8/.p7b/.kdbx/.ovpn`),
  `kubeconfig`, and the `.aws/.ssh/.kube/.gnupg/.docker` directories. Binary files
  (detected by a NUL byte) are skipped entirely, since a raw-binary secret matches
  no text regex. The module now documents that it is best-effort — run gitleaks
  over the candidate set when stronger assurance is required.
- fe0f33c: Abort the in-flight AI request when its timeout fires. `withTimeout` now creates
  an `AbortController` and passes its signal to the Anthropic SDK call, aborting it
  in the `finally` branch. Previously a timed-out request kept running server-side
  while a retry was billed alongside it, and those extra tokens never reached
  `.factory/ai-usage.log`.
- b947439: Stop the factory's own `factory.yml` from satisfying `ci.workflow.present`, so a
  fresh repo actually gets a real CI workflow. The `file-exists` detector gains an
  optional `exclude` glob (paths that do NOT count as a match), and
  `ci.workflow.present` now excludes `.github/workflows/factory.yml`. Previously a
  repo scaffolded by `init` ended up with `factory.yml` but no test/lint/build
  workflow, because the control passed on `factory.yml` alone and `factory fix`
  never fired the `ci-workflow` template (and the `ci.concurrency` /
  `ci.workflow-permissions` merges then had no `ci.yml` target). Closes #62.
- fe0f33c: Make the `claude` fix generator idempotent. AI output is non-deterministic and
  carries a `date:` header, so re-running `factory fix` regenerated the artifact,
  produced a fresh diff every run, and burned an API call (and, under `--pr`, a
  new commit). The generator now produces the draft once: if the task's output
  file already exists it makes no change. Redraft deliberately with
  `factory ai <task> --pr`.
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
- fe0f33c: Harden the Windows command runner against a CWD-search hijack. `resolveOnWindows`
  no longer includes `process.cwd()` in its search path — tools run with
  `cwd = repoPath`, so a malicious repo could drop a `scorecard.cmd`/`npm.cmd` in
  its root and have it executed ahead of the real tool. Bare command names now
  resolve from `PATH`/`PATHEXT` only, matching how `cmd.exe`/`where` behave.
- fe0f33c: Honor the `exists` option in the `file-json-path` / `file-yaml-path` detectors.
  It was declared in the schema but never read, so `exists: false` (assert the
  path is absent) silently passed exactly when the path was present — the opposite
  of its intent. `exists: false` now passes only when the path is absent in every
  matched file; `exists: true` / omitted keeps the existing "path must exist"
  behavior. The schema description is updated to match.
- fe0f33c: Make `factory fix --pr` always return the working tree to the base branch. A
  failed `git push` or PR-creation call used to leave the user checked out on the
  `factory/…` branch; the push/open-PR step now runs in a `try`/`finally` that
  restores the base branch on any failure. Also refuse to run on a detached HEAD
  (which reported `base: "HEAD"` and produced a 422 that stranded the branch).
- fe0f33c: Honor the merge policy's `.factory-suggested` escape hatch. A `merge` fix that
  targets a file the factory previously wrote but a human has since edited no
  longer re-serializes over those edits; it writes the merged result alongside as
  `<path>.factory-suggested` and reports a `suggest` action so the human can
  reconcile it by hand. First-time merges into a human-authored file (minimal
  structural insertion) are unchanged.
- fe0f33c: Fix the Claude Opus 4.8 price table entry: it was `$15/$75` per 1M tokens (the
  Opus 4.1 rate) but Opus 4.8 is `$5/$25`. Every Opus cost estimate in
  `.factory/ai-usage.log`, the `factory ai` cost line, and `factory ai usage` was
  inflated 3×.
- fe0f33c: Contain generator writes and AI reads to the target repo (ADR-0004). A new
  `paths.ts` adds `resolveInsideRepo` (rejects `..`/absolute escapes),
  `assertNoSymlinkEscape` (refuses a write whose target is a symlink or whose
  intermediate directory symlinks outside the repo), and `containedReadPath`
  (follows symlinks only while they stay inside the repo). `applyChanges` now runs
  every file change through these guards before any read/write — an escaping path
  is reported as a visible skip instead of silently writing outside the repo. On
  the read side, `ctx.glob` no longer follows symbolic links and `ctx.readFile`
  treats a symlink that escapes the repo as absent, so a repo cannot alias a file
  to `~/.aws/credentials` and leak it into AI context.
- 25b2f62: Fix the `branch-protection`, `required-pull-request`, and `required-status-checks`
  github-api checks to recognise repository rulesets, not only classic branch
  protection. The rules endpoint needs just read access, so these checks no longer
  false-fail (or need admin) on repos protected by a ruleset.
- a156198: Tighten controls flagged by the M1 review to remove false passes:
  `test.runner.configured` now requires a real test runner (not npm's "no test
  specified" placeholder or a dependency named `test`); `ci.dependency-caching`
  drops the greedy `setup-node[\s\S]*cache` match; `dev.conventional-commits` no
  longer matches an incidentally-named package.json dependency; `ci.runs-on-push`
  and `sec.scorecard.score` titles/rationales no longer overclaim; and
  `dev.precommit-hooks` cites a relevant reference. Adds an engine test that loads
  the bundled catalog and compiles every `file-matches` pattern, so a malformed
  pattern fails CI instead of silently skipping at audit time.
- 681f6ef: Harden the engine after the M1 review: `getByPath` now matches only own data
  properties and in-range array indices (no prototype keys like `toString`, no
  array `length`/methods), preventing false-pass structured-path checks;
  `evaluateControl` no longer crashes the whole run on an unreadable evidence file;
  context memos evict rejected promises instead of caching and amplifying them;
  `branch-protection` requires a merge-gating ruleset rule (not a lone
  `non_fast_forward`); unparseable `valid-for` fails closed; and `parseRepoSlug`
  rejects non-bare URLs with extra path segments.
- be6c303: Harden the engine after the M2 review: waiver/evidence expiry now uses an inclusive
  end-of-day for bare `YYYY-MM-DD` dates (they no longer expire ~a day early); a gate
  whose selector matches nothing is `amber`, not silently `green`; `loadEvidence`
  throws on a malformed file instead of silently returning none; config writes
  (`addWaiver`/`addEvidence`/`saveProfile`) are atomic (temp + rename); the CI
  comment/status-issue upserts paginate and reopen a closed status issue instead of
  duplicating; and waiver `expires`/`created` are validated as ISO dates.
- 2a4bd4d: M3 dogfood fixes. Make the `command` fix runner work on Windows: `runTool` now
  resolves a bare command via `PATH`+`PATHEXT` (so a missing tool is still a clean
  `ToolNotFoundError`) and runs through a shell, so `.cmd`/`.bat` shims like `npm`
  execute instead of failing with "not installed". Add a stack-aware `toolchain`
  template (`.nvmrc` for node, `.python-version` for python) and wire it as the fix
  for `repo.toolchain-pinned`, which previously had no generator and so left the
  scaffold gate unreachable. See docs/audit-notes.md for the full dogfood log.
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
- e84788b: M5.4 — Profile screen in the desktop shell, and a new engine `updateProfile` that
  writes `.factory/profile.yml` with a **minimal, comment-preserving** edit (only
  changed leaves; an absent flag/lane keeps its default, so toggling one flag yields
  a one-line diff). The desktop form edits type, phase, severity-floor, stack, risk
  flags, and lane toggles — driven by catalog enum lists sent over IPC, so the
  renderer never imports the catalog — and saves through `updateProfile`.
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

- Updated dependencies [fe0f33c]
- Updated dependencies [b947439]
- Updated dependencies [fe0f33c]
- Updated dependencies [1b932c6]
- Updated dependencies [2f52773]
- Updated dependencies [01d4b28]
- Updated dependencies [a156198]
- Updated dependencies [0e83bcc]
- Updated dependencies [16b72ba]
- Updated dependencies [ab8dd05]
- Updated dependencies [be6c303]
- Updated dependencies [8581cc7]
- Updated dependencies [2a4bd4d]
- Updated dependencies [473e9bc]
- Updated dependencies [d1fb3be]
- Updated dependencies [abba775]
- Updated dependencies [7e613e2]
- Updated dependencies [a97d22f]
- Updated dependencies [81ce412]
- Updated dependencies [fe0f33c]
- Updated dependencies [1f1030b]
- Updated dependencies [869e453]
- Updated dependencies [96bd726]
  - @arynbht/factory-catalog@1.0.0
