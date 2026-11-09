# Code quality



Outcomes, not configuration: lint, typecheck, and tests actually pass; coverage holds its floor; merges require them.



5 control(s).



### `quality.coverage.floor` — Coverage at or above the floor

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `file-json-path` · **fix**: —

Coverage doesn't prove tests are good, but a falling number shows untested code arriving. A floor keeps new work from lowering it.

References:
  - [Google Testing Blog — Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html) — Is a code coverage of X% good enough?

### `quality.lint.clean` — Lint passes

- **phase**: build · **severity**: high · **effort**: small
- **detect**: `command` · **fix**: —

A linter only protects the codebase when its findings block a change. Checking that lint passes, rather than that a config exists, is what stops sloppy code from merging.

References:
  - [Google — Software Engineering at Google (Static Analysis)](https://abseil.io/resources/swe-book/html/ch20.html) — Tricorder

### `quality.required-checks.named` — Merges require passing status checks

- **phase**: build · **severity**: high · **effort**: small
- **detect**: `github-api` · **fix**: github-setting `branch-protection`

Checks that don't block a merge are advisory. Requiring them on the default branch is what turns lint, typecheck and tests into a gate.

References:
  - [GitHub Docs — About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — Require status checks before merging

### `quality.tests.pass` — Tests pass

- **phase**: build · **severity**: critical · **effort**: small
- **detect**: `command` · **fix**: —

A test suite that isn't run, or is allowed to stay red, gives no protection. Requiring a green run on every change is the minimum bar for changing code with confidence.

References:
  - [Google — Software Engineering at Google (Testing Overview)](https://abseil.io/resources/swe-book/html/ch11.html) — Why Do We Write Tests?

### `quality.typecheck.clean` — Typecheck passes

- **phase**: build · **severity**: high · **effort**: small
- **detect**: `command` · **fix**: —

Strict mode is only a promise until the compiler runs. A typecheck that passes on every change is what makes the type system a safety net.

References:
  - [TypeScript Handbook — tsc CLI options](https://www.typescriptlang.org/docs/handbook/compiler-options.html) — noEmit


