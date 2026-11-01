---
"@arynbht/factory": patch
---

Harden the `factory ci` Action entrypoint after the M2 review: an unknown
`FACTORY_GATE` now fails closed (was: every PR passed green); a malformed
profile/waivers/evidence file fails with an error (was: silently ignored); PR
context is detected by a resolvable PR number rather than only the literal
`pull_request` event; an amber scheduled gate keeps the status issue open instead
of closing it; expiring waivers/evidence are listed in the report body; and GitHub
annotations escape newlines/`%`/`,` so a detector message can't truncate or spoof
them.
