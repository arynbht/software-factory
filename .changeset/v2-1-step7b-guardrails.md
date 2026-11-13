---
"@arynbht/factory": minor
"@arynbht/factory-catalog": patch
"@arynbht/factory-engine": patch
"@arynbht/factory-runtime": patch
---

Factory v2.1 step 7b: the guardrails fail closed.

- `factory init --force` never deletes: the profile and `factory.yml` it replaces
  are backed up, and waivers and evidence are written only when missing.
- `init` merges its hooks into an existing `.claude/settings.json` (backing it up)
  instead of writing a sibling file Claude Code never reads; a re-run replaces an
  earlier init's hooks rather than adding a second set.
- The guard hook fails closed: `factory hook guard || exit 2` blocks the call when
  `factory` can't run. It now covers Bash too: writes through redirects, `tee`,
  `cp`, `mv`, `rm`, `sed -i` and the like to anything the edit guard protects, and
  git commands that destroy work (force push, remote delete, `reset --hard`,
  `clean -f`, `branch -D`). Bash checks are a heuristic; the judge is the backstop.
- `factory hook session-start` says on its first line whether the guard is on, and
  `factory doctor` fails until the hook is installed and `factory` runs from a shell.
- The Node CI template runs only the lint, typecheck and test scripts the repo has,
  without `--if-present`; the `dev.linter.in-ci` and `test.runner.in-ci` fixes add
  real steps and deduplicate on the command, not the step name.
- `factory review --pr` deletes its `refs/factory/pr-<n>` ref when it's done.
