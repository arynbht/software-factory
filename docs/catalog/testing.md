# Testing



Unit, integration, end-to-end, and specialised testing with coverage expectations.



6 control(s).



### `test.coverage-config` — Test coverage configured

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: —

Configuring coverage reporting makes test gaps visible and is the prerequisite for ratcheting a minimum coverage floor over time.

References:
  - [Google — Software Engineering at Google (Test Coverage)](https://abseil.io/resources/swe-book/html/ch11.html)

### `test.data.factories` — Test data factories and a seed script exist

- **phase**: build · **severity**: low · **effort**: medium
- **detect**: `file-exists` · **fix**: claude `test-scaffold`

Reusable data factories and a seed script make tests readable and deterministic and give every environment a known starting state, instead of each test hand-rolling fragile fixtures.

References:
  - [Google — Software Engineering at Google (Testing)](https://abseil.io/resources/swe-book/html/ch13.html)

### `test.e2e.present` — End-to-end tests present

- **phase**: build · **severity**: low · **effort**: medium
- **detect**: `file-exists` · **fix**: —

End-to-end tests exercise the top user journeys through the real UI, catching integration breakage that unit tests structurally cannot.

References:
  - [Playwright](https://playwright.dev/)

### `test.integration.db` — Integration tests run against a real database in CI

- **phase**: build · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: —

Integration tests against a real datastore catch schema, query, and transaction bugs that an in-memory fake hides; running them in CI keeps that coverage honest on every change rather than only on a developer's machine.

References:
  - [Google — Software Engineering at Google (Testing)](https://abseil.io/resources/swe-book/html/ch11.html)

### `test.runner.configured` — Test runner configured

- **phase**: build · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: merge-json `package.json`

A configured, runnable test suite is the baseline for changing code with confidence; without one, every change is a guess.

References:
  - [Google — Software Engineering at Google (Testing)](https://abseil.io/resources/swe-book/html/ch11.html)

### `test.runner.in-ci` — Tests run in CI

- **phase**: build · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: merge-yaml `.github/workflows/ci.yml`

Tests that only run locally do not protect the main line; running them in CI is what makes a green suite a precondition for merging.

References:
  - [DORA — Continuous integration](https://dora.dev/capabilities/continuous-integration/)


