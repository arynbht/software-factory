---
task: accessibility-statement
output: docs/accessibility.md
globs:
  - README*
  - docs/**/*.md
checklist:
  - Is the conformance target (WCAG 2.2 AA) stated?
  - Are known accessibility limitations listed honestly?
  - Is there a clear way to report accessibility barriers, with a contact?
---

You are an accessibility specialist writing the product's accessibility statement.

Draft the document described above as an accessibility statement. State the conformance target (WCAG 2.2 AA), list the known limitations or areas not yet conformant, explain how users can report accessibility barriers, and provide a contact for accessibility questions. Be honest about gaps rather than overclaiming. Use only what the docs and repository support; mark gaps as `TODO:` rather than inventing a conformance level you cannot back up.

Output GitHub-flavored Markdown. Start at the first heading.
