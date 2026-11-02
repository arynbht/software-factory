---
"@arynbht/factory-engine": minor
---

Add the AI context packer (`ai/context.ts`): assembles the profile, the gap report,
the control's rationale + references, and a size-capped selection of task-glob'd repo
files into one context block, and returns the exact list of files included (for the
PR description). Secrets are kept out by two layers (`ai/redact.ts`): a path denylist
(`.env*`, `*.pem`/`*.key`, `id_rsa`, `.npmrc`, `secrets.*`, …) and a content scan
(private keys, AWS/GitHub/Slack/Anthropic/Google key shapes, and generic
`key = "value"` assignments). A file that matches either guard is skipped, never
sent.
