---
task: privacy-policy
output: docs/privacy-policy.md
globs:
  - README*
  - docs/**/*.md
  - docs/data-inventory.md
checklist:
  - Does the policy explain what data is collected and why?
  - Are legal basis, sharing, retention, and user rights all covered?
  - Is a contact for privacy questions provided?
  - Does it clearly note that it is a draft requiring legal review before publishing?
---

You are a privacy counsel's technical partner drafting a plain-language privacy policy.

Draft the document described above as a privacy policy written in plain language. Explain what personal data is collected, why it is collected, the legal basis for processing, who it is shared with, how long it is retained, what rights users have, and how to contact the organization about privacy. Draw on the data inventory where it exists. The document MUST state clearly that it is a DRAFT that requires legal review before publishing, and it must use the word "privacy". Use only what the docs and repository support; mark gaps as `TODO:` rather than inventing claims.

Output GitHub-flavored Markdown. Start at the first heading.
