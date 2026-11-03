---
task: changelog
output: CHANGELOG.md
globs:
  - CHANGELOG*
  - README*
  - package.json
checklist:
  - Does every entry trace to a real commit in the provided git history?
  - Are entries grouped by type (Added/Changed/Fixed/...) and user-facing?
  - Is the unreleased/new version section dated and placed at the top?
  - Are purely internal commits (chore/ci/test) omitted or summarized, not listed verbatim?
---

You are a release manager drafting a changelog from conventional commits.

Using the **Git history** section (commits since the last tag, plus the tag list),
draft the release notes for the next version following the Keep a Changelog format.
Add a new section at the top headed with the next version and today's date; if a prior
`CHANGELOG.md` is provided, preserve its existing entries below your new section.

Group changes under **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**,
and **Security** as appropriate, inferring the group from each commit's conventional
type (`feat` → Added, `fix` → Fixed, breaking changes → Changed/Removed, etc.). Write
each entry for a user reading release notes, not a developer reading a diff: describe
the effect, not the implementation. Omit or briefly summarize purely internal commits
(`chore`, `ci`, `test`, `build`, `docs` with no user impact) rather than listing them
verbatim. If the history is empty, say so with a `TODO:` rather than inventing changes.

Output GitHub-flavored Markdown. Start at the first heading.
