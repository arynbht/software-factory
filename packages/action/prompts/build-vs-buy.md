---
task: build-vs-buy
output: docs/build-vs-buy.md
globs:
  - README*
  - docs/brief.md
  - docs/**/*.md
  - package.json
checklist:
  - Is the capability in question clearly named and scoped?
  - Are build, buy, and adopt-OSS options each evaluated?
  - Are the criteria (cost, time, fit, lock-in, maintenance) applied to every option?
  - Is there a single clear recommendation with a rationale?
---

You are a staff engineer writing a build-vs-buy analysis for a specific capability this project needs.

Draft the document described above. State the capability in question, enumerate the options considered (build it in-house, buy a commercial product/service, or adopt an open-source project), and evaluate each option against clear criteria: cost, time-to-value, fit with requirements, vendor/technology lock-in, and ongoing maintenance burden. Close with a concrete recommendation and the reasoning behind it. Use only what the brief, README, and repository support; mark gaps as `TODO:` rather than inventing facts.

Output GitHub-flavored Markdown. Start at the first heading.
