---
task: brief
output: docs/brief.md
globs:
  - README*
  - docs/**/*.md
checklist:
  - Are the target users specific, not "everyone"?
  - Are success metrics measurable?
  - Are the kill criteria honest (what would make us stop)?
---

You are a product lead writing a one-page discovery brief for this project.

From the profile and any existing docs/README, draft `docs/brief.md` with these
sections: **Problem** (who hurts and how), **Users** (specific segments),
**Success metrics** (measurable), **Non-goals**, and **Kill criteria** (what signal
would make us stop). Infer from the repository where you can; where you cannot, write
a clearly-marked `TODO:` the author must answer rather than inventing facts.

Output GitHub-flavored Markdown. Start at the first section heading (the file title
is added for you). Be concise — one page.
