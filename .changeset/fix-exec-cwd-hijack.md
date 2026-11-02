---
"@arynbht/factory-engine": patch
---

Harden the Windows command runner against a CWD-search hijack. `resolveOnWindows`
no longer includes `process.cwd()` in its search path — tools run with
`cwd = repoPath`, so a malicious repo could drop a `scorecard.cmd`/`npm.cmd` in
its root and have it executed ahead of the real tool. Bare command names now
resolve from `PATH`/`PATHEXT` only, matching how `cmd.exe`/`where` behave.
