---
"@arynbht/factory-engine": patch
"@arynbht/factory": patch
---

Engine correctness fixes from the full-repo review:

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
