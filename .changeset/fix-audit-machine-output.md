---
"@arynbht/factory": patch
---

Keep `factory audit` machine output valid. Previously `--gate` appended
human-readable, colorized gate lines to stdout and the "waiver/evidence
expiring" warnings were always written to stdout, so `--json` / `--format
markdown|github` combined with a gate (or an expiring waiver) produced
unparseable output. Gate results are now folded into the JSON object (a `gates`
array) and rendered in-format for markdown/github; advisory expiry warnings go
to stderr for machine formats. `--format table` is unchanged.
