---
"@arynbht/factory-registry": minor
"@arynbht/factory-engine": minor
"@arynbht/factory-runtime": minor
"@arynbht/factory-cli": patch
---

Registry review rules: `scan_allow` binds to one exact line (sha256) with a named
reviewer and is ignored once the lock pins another commit; licenses outside the
OSI allow-list need a signed `license_review`; legal-sector skills must name the
controls they serve; the `.factory/` scan rule matches repo paths only;
`pnpm registry:scan` lists open findings. The judge protects the skill registry
and agent harness settings, and runs installs and checks with an environment
allowlist (`allowlistedEnv`; `--env` to pass more). Manifests: drop
app-store-compliance and privacy-threshold-analysis; add a11y-core (required by
accessibility-lead), three control-mapped privacy skills, and insecure-defaults
(task scope, last skill commit).
