---
"@arynbht/factory-catalog": minor
"@arynbht/factory": minor
---

Add the Claude Code skill (`packages/catalog/skill/SKILL.md`, exposed via
`bundledSkillDir`): it teaches an agent in a target repo to run `factory audit`
instead of guessing, read the gap report, and remediate with `factory fix` or draft
missing artifacts with `factory ai`, under "Claude drafts, humans sign". `factory
init` now installs it into `.claude/skills/factory/SKILL.md` (never-clobber; init
doesn't fail if it can't be read), and the action bundle copies `skill/` and folds
it into the staleness hash.
