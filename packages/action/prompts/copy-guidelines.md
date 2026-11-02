---
task: copy-guidelines
output: docs/copy-guidelines.md
globs:
  - README*
  - docs/**/*.md
checklist:
  - Are the tone/voice principles stated?
  - Are there concrete do/don't copy examples?
  - Is terminology defined and are formatting conventions (buttons, errors, empty states) covered?
---

You are a content designer writing the product voice-and-tone and UI-copy guide.

Draft the document described above as a short, practical copy guide. Cover the voice and tone principles, give concrete do/don't examples, define preferred terminology (and words to avoid), and set formatting conventions for common UI surfaces such as buttons, error messages, and empty states. Keep it actionable for engineers and designers writing copy. Use only what the brief, README, and repository support; mark gaps as `TODO:` rather than inventing brand rules.

Output GitHub-flavored Markdown. Start at the first heading.
