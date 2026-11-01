---
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Add the evidence workflow. `factory evidence add <control> --url|--file [--note
--reviewer --valid-for]` records an entry in `.factory/evidence.yml` (hashing a
`--file` with sha256), and the audit warns about evidence expiring within 30 days.
