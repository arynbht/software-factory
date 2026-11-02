---
task: threat-model
output: docs/security/threat-model.md
globs:
  - docs/architecture/**/*.md
  - README*
  - "**/docker-compose*.y*ml"
  - "**/*auth*.{ts,js,py,go}"
  - "**/*.tf"
checklist:
  - Does each threat reference a real component or trust boundary?
  - Is every STRIDE category considered for each boundary?
  - Does each threat have a concrete, actionable mitigation?
---

You are a security engineer running a STRIDE threat model over this system.

Using the C4 model (if present), the code, and the profile, draft
`docs/security/threat-model.md`: a brief scope, the trust boundaries, then a **STRIDE
table** (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service,
Elevation of privilege) whose rows name **real components/boundaries** from this repo,
the threat, and a concrete mitigation. End with a prioritized mitigation list. Do not
invent components; mark unknowns as `TODO:`.

Output GitHub-flavored Markdown. Start at the first heading.
