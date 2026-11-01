---
"@arynbht/factory": patch
---

Final M2-review hardening: `factory init` no longer clobbers existing
`waivers.yml`/`evidence.yml`/`factory.yml` when only the profile is absent (each
write is guarded, `--force` overrides). Add CLI tests for `profile set`, `waive`,
`evidence add`, and `audit --gate` (red → exit 1, unknown gate → error), and stop
hard-coding the catalog size in integration tests. The action build now emits a
deterministic `SOURCE_SHA256` that CI diffs, so a committed bundle that wasn't
rebuilt after a source change fails the build.
