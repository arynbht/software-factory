---
"@arynbht/factory-engine": patch
"@arynbht/factory-catalog": patch
---

M3 dogfood fixes. Make the `command` fix runner work on Windows: `runTool` now
resolves a bare command via `PATH`+`PATHEXT` (so a missing tool is still a clean
`ToolNotFoundError`) and runs through a shell, so `.cmd`/`.bat` shims like `npm`
execute instead of failing with "not installed". Add a stack-aware `toolchain`
template (`.nvmrc` for node, `.python-version` for python) and wire it as the fix
for `repo.toolchain-pinned`, which previously had no generator and so left the
scaffold gate unreachable. See docs/audit-notes.md for the full dogfood log.
