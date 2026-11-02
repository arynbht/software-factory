---
"@arynbht/factory-engine": patch
---

Contain generator writes and AI reads to the target repo (ADR-0004). A new
`paths.ts` adds `resolveInsideRepo` (rejects `..`/absolute escapes),
`assertNoSymlinkEscape` (refuses a write whose target is a symlink or whose
intermediate directory symlinks outside the repo), and `containedReadPath`
(follows symlinks only while they stay inside the repo). `applyChanges` now runs
every file change through these guards before any read/write — an escaping path
is reported as a visible skip instead of silently writing outside the repo. On
the read side, `ctx.glob` no longer follows symbolic links and `ctx.readFile`
treats a symlink that escapes the repo as absent, so a repo cannot alias a file
to `~/.aws/credentials` and leak it into AI context.
