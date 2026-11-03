---
"@arynbht/factory-engine": patch
"@arynbht/factory-catalog": patch
---

Stop the factory's own `factory.yml` from satisfying `ci.workflow.present`, so a
fresh repo actually gets a real CI workflow. The `file-exists` detector gains an
optional `exclude` glob (paths that do NOT count as a match), and
`ci.workflow.present` now excludes `.github/workflows/factory.yml`. Previously a
repo scaffolded by `init` ended up with `factory.yml` but no test/lint/build
workflow, because the control passed on `factory.yml` alone and `factory fix`
never fired the `ci-workflow` template (and the `ci.concurrency` /
`ci.workflow-permissions` merges then had no `ci.yml` target). Closes #62.
