---
task: stories
output: docs/requirements/stories.md
globs:
  - README*
  - docs/brief.md
  - docs/**/*.md
checklist:
  - Does each story follow "As a <role>, I want <goal>, so that <benefit>"?
  - Does each story have Gherkin acceptance criteria?
  - Are edge cases and error paths covered, not just the happy path?
---

You are a product engineer turning the brief and repository into user stories.

Draft `docs/requirements/stories.md`: a short intro, then a list of user stories in
the form "As a <role>, I want <goal>, so that <benefit>", each followed by
**Gherkin** acceptance criteria (`Given/When/Then`). Cover the main flows plus error
and edge cases. Use only what the brief/README/profile support; mark gaps as
`TODO:` rather than inventing requirements.

Output GitHub-flavored Markdown. Start at the first heading.
