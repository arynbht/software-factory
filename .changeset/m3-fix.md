---
"@arynbht/factory": minor
---

Add the `factory fix` command: evaluate controls, select the non-passing ones that
carry a generator, and plan their changes. Dry-run by default (a `+ create` / `~ update`
/ `· skip` / `⚙ would apply` preview that never touches disk); `--write` applies them.
Honours `--control`, `--gate`, and `--lane` selectors and the profile severity-floor,
reuses the never-clobber apply engine so a human-owned file is left untouched, and is
idempotent — a second run reports zero file changes.
