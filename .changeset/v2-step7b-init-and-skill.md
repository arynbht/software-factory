---
"@arynbht/factory-runtime": minor
"@arynbht/factory-catalog": minor
"@arynbht/factory-cli": minor
---

Factory v2 step 7b: `/factory` as the single entry point.

- `factory init` writes the §10 files without overwriting: an existing file gets
  the factory's version beside it as `name.factory.ext`. The files are AGENTS.md
  (the contract, with a repo section listing the detected stack and commands),
  CLAUDE.md pointing at it, a CONSTRAINTS.md seed for the judge, the PR template
  with `## Proof`, `.claude/settings.json` hooks, and the v2 `/factory` skill. It
  also locks the spine skills and adds `.factory/.gitignore` entries.
- `factory task run <id>` takes an approved task through isolate, build, prove,
  judge and ship, reporting each ledger entry as it lands. It stops wherever a
  person is needed, and after four build rounds.
- `factory doctor` checks the profile, the `claude` CLI, GitHub access and skills.
- `factory hook session-start` and `factory hook guard`: the guard refuses edits to
  `.factory/**`, and edits in the primary checkout while it's on the default branch.
