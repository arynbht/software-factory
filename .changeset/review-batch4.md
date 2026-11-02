---
"@arynbht/factory": patch
"@arynbht/factory-engine": patch
---

Test coverage and cross-platform CI from the full-repo review:

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
