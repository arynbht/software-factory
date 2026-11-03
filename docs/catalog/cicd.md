# CI/CD & release



Continuous integration, caching, action pinning, versioning, and release automation.



8 control(s).



### `ci.actions-pinned-sha` — GitHub Actions pinned by commit SHA

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: merge-yaml `.github/workflows/ci.yml`

Pinning third-party actions to a full commit SHA, not a mutable tag, stops a compromised or retagged action from silently executing new code in CI.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Pinned-Dependencies
  - [GitHub Docs — Security hardening for GitHub Actions](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)

### `ci.changelog-automated` — Versioning and changelog automated

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `changesets`

Automated versioning and changelogs make releases repeatable and give users an accurate record of what changed, instead of hand-maintained notes that drift.

References:
  - [semantic-release](https://semantic-release.gitbook.io/semantic-release/)
  - [Changesets](https://github.com/changesets/changesets)

### `ci.concurrency` — CI cancels superseded runs

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: merge-yaml `.github/workflows/ci.yml`

A concurrency group cancels superseded in-progress runs on the same ref, saving runner minutes and giving faster feedback on the latest commit.

References:
  - [GitHub Docs — Using concurrency](https://docs.github.com/actions/using-jobs/using-concurrency)

### `ci.dependency-caching` — CI caches dependencies

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: merge-yaml `.github/workflows/ci.yml`

Caching dependencies cuts CI time and cost and reduces load on upstream registries, keeping the feedback loop fast as the project grows.

References:
  - [GitHub Docs — Caching dependencies to speed up workflows](https://docs.github.com/actions/using-workflows/caching-dependencies-to-speed-up-workflows)

### `ci.runs-on-pr` — CI runs on pull requests

- **phase**: scaffold · **severity**: high · **effort**: small
- **detect**: `file-matches` · **fix**: —

Running CI on pull requests is what lets required checks block a merge; a workflow that only runs on push cannot gate incoming changes.

References:
  - [GitHub Docs — Events that trigger workflows (pull_request)](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#pull_request)

### `ci.runs-on-push` — CI runs on push

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: —

A push trigger keeps the mainline continuously verified, catching breakage introduced by merges. (This heuristic detects any push trigger; confirming it targets the default branch specifically is left to a future structured check.)

References:
  - [GitHub Docs — Events that trigger workflows (push)](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#push)

### `ci.workflow-permissions` — Workflow token permissions declared

- **phase**: harden · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: merge-yaml `.github/workflows/ci.yml`

An explicit permissions block scopes the workflow's GITHUB_TOKEN to least privilege, limiting the blast radius if a step or dependency is compromised.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Token-Permissions

### `ci.workflow.present` — CI workflow present

- **phase**: scaffold · **severity**: high · **effort**: small
- **detect**: `file-exists` · **fix**: template `ci-workflow`

A CI workflow is the foundation for every automated gate; without one, nothing (tests, lint, security scans) is enforced on changes.

References:
  - [DORA — Continuous integration](https://dora.dev/capabilities/continuous-integration/)


