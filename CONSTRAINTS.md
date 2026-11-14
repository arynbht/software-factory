# CONSTRAINTS.md

<!-- Seeded by `factory init`. The judge's review blocks a change that breaks a rule
here, so keep every rule concrete enough to check against a diff. Add this codebase's
rules below; delete any of these that don't fit. -->

## Always

- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` pass, with no new warnings.
- No new dependency without asking first.
- Nothing silences a check: no new `eslint-disable`, `@ts-ignore`, `# noqa` or skipped tests.
- New behaviour comes with new tests; existing tests aren't changed to make a change pass.
- No secrets, keys or tokens in code, tests, fixtures or logs.
- Errors are handled or passed on with context, never swallowed.

## This codebase

<!-- e.g. "All database access goes through src/db/; nothing else imports the driver." -->

- Anything that runs repo code (installs, checks, proof, the build agent) gets the
  allowlisted environment, never the caller's: no tokens or API keys reach it.
- Fail closed: a check, proof or guard that can't run reports red, never green.
- Only the runtime writes a task's ledger; nothing else appends to or edits it.
- The factory never merges, approves its own PR, or lowers a gate.
- GitHub calls go through `githubToken()` (explicit, env, the App, then `gh`), not a
  token read some other way.
