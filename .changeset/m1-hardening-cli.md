---
"@arynbht/factory": patch
---

Harden the audit CLI after the M1 review: validate `--format` against
`table|json` (an unknown value is now rejected, not silently rendered as a
table); fail fast with a clear message when the audit path is missing or not a
directory; disable colour for non-TTY output and when `NO_COLOR` is set; and stop
shipping `.tsbuildinfo` inside published packages. Adds an end-to-end `runAudit`
integration test (report output, lane filter, `.factory/state.json` contents, and
exit code) with an offline token override so it needs no network.
