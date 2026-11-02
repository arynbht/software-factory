---
"@arynbht/factory-engine": patch
"@arynbht/factory-catalog": patch
---

Catalog safety fixes from the full-repo review — `factory fix` can no longer
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
