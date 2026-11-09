# Development



Linting, formatting, type safety, local hooks, and config hygiene for day-to-day work.



8 control(s).



### `dev.code-review-required` — Code review required before merge

- **phase**: build · **severity**: high · **effort**: small
- **detect**: `github-api` · **fix**: github-setting `required-pull-request`

Requiring a pull request review before merge catches defects early and ensures no change reaches the default branch without a second set of eyes.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Code-Review
  - [DORA — Code review](https://dora.dev/capabilities/code-review/)

### `dev.conventional-commits` — Conventional commits enforced

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: template `commitlint`

Enforcing conventional commit messages enables automated changelogs and version bumps and keeps history machine- and human-readable.

References:
  - [Conventional Commits](https://www.conventionalcommits.org/)

### `dev.env-example` — .env.example present

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `env-example`

An .env.example documents required configuration without committing secrets, so a fresh clone knows exactly which environment variables to set.

References:
  - [Twelve-Factor App — Config](https://12factor.net/config)

### `dev.formatter.configured` — Formatter configured

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `any-of` · **fix**: template `formatter`

An enforced formatter ends style debates and keeps diffs focused on behavioural changes rather than reformatting churn.

References:
  - [Prettier — Why Prettier?](https://prettier.io/docs/why-prettier)

### `dev.linter.configured` — Linter configured

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `any-of` · **fix**: template `linter`

A configured linter catches a class of bugs and style drift before review, keeping the codebase consistent as it and the team grow.

References:
  - [Twelve-Factor App — Dev/prod parity](https://12factor.net/dev-prod-parity)

### `dev.linter.in-ci` — Linter runs in CI

- **phase**: build · **severity**: medium · **effort**: small
- **detect**: `any-of` · **fix**: merge-yaml `.github/workflows/ci.yml`

Running the linter in CI, not just locally, makes the standard enforceable on every pull request regardless of each contributor's local setup.

References:
  - [DORA — Continuous integration](https://dora.dev/capabilities/continuous-integration/)

### `dev.precommit-hooks` — Pre-commit hooks installed

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-exists` · **fix**: template `lefthook`

Pre-commit hooks catch formatting, lint, and secret issues before they are committed, shortening the feedback loop and keeping bad commits out of history.

References:
  - [pre-commit framework](https://pre-commit.com/)
  - [lefthook](https://github.com/evilmartians/lefthook)

### `dev.typecheck.strict` — TypeScript strict mode enabled

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-json-path` · **fix**: merge-json `tsconfig.json`

Strict mode turns the compiler into a real safety net (null checks, implicit any, and more); without it much of TypeScript's value is lost.

References:
  - [TypeScript Handbook — Strictness](https://www.typescriptlang.org/tsconfig/#strict)


