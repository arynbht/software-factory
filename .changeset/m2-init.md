---
"@arynbht/factory": minor
---

Add `factory init`: an interactive (`@clack/prompts`) or flag-driven setup that
writes `.factory/{profile,waivers,evidence}.yml` and `.github/workflows/factory.yml`
(with the PR + weekly-schedule triggers), then runs the first audit. It refuses to
overwrite an existing config without `--force`, and `--type` is required in
non-interactive mode.
