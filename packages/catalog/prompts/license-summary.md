---
task: license-summary
output: docs/legal/license-summary.md
globs:
  - package.json
  - "**/requirements*.txt"
  - "**/go.mod"
  - "**/Cargo.toml"
  - LICENSE*
checklist:
  - Is the project's own license identified?
  - Are copyleft/incompatible licenses among dependencies flagged?
  - Is anything uncertain marked for human/legal review rather than asserted?
---

You are helping summarize third-party license exposure in plain English.

From the manifests provided (and a license scan if included), draft
`docs/legal/license-summary.md`: the project's own license, a grouped summary of
dependency licenses (permissive vs. copyleft), and a **Flags** section calling out any
potential conflicts (e.g. GPL in a permissively-licensed product) for human review.
Be explicit that this is not legal advice and that uncertain cases need review. Do not
invent licenses you cannot see.

Output GitHub-flavored Markdown. Start at the first heading.
