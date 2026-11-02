---
"@arynbht/factory": minor
---

Add the `factory ai <task> [path]` command: runs the audit for gap context, drafts
the artifact with Claude (via the `claude` generator), and previews it (dry-run
default), applies it with `--write`, or opens/reuses a PR with `--pr`. Reports the
model, token usage, and the exact files consulted, and gives clear errors for a
missing `ANTHROPIC_API_KEY` or an unknown task (listing the available ones).
