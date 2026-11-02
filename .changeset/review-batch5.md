---
"@arynbht/factory": patch
---

CLI UX polish from the full-repo review:

- `factory fix` and `factory ci` now list each catalog error (file + message) on an
  invalid catalog, matching `factory audit` instead of printing only a count.
- `factory profile set flags.<x>`/`lanes.<x>` rejects a non-boolean value instead
  of silently coercing it to `false`.
- `factory evidence add` reports errors with a `factory evidence add:` prefix and
  unwraps `EvidenceError`, consistent with the other commands.
- `factory audit` errors when `--json` and a conflicting `--format` are both given
  (`--json` is shorthand for `--format json`).
- `factory fix --control <id>` help note: it applies regardless of the severity
  floor.
- `factory fix` "nothing to apply" message is accurate whether controls already
  pass or simply have no generator.
