# Repo hygiene & governance



Baseline repository files, branch protection, and governance that every repo needs.



10 control(s).



### `repo.branch-protection` — Default branch is protected

- **phase**: scaffold · **severity**: high · **effort**: small
- **detect**: `github-api` · **fix**: github-setting `branch-protection`

Protecting the default branch (requiring PRs and checks, blocking force-push) prevents unreviewed or history-rewriting changes from landing on main.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Branch-Protection
  - [GitHub Docs — About protected branches](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

### `repo.codeowners.present` — CODEOWNERS present

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `codeowners`

A CODEOWNERS file routes review requests to the people responsible for each path, so changes are not merged without an accountable reviewer.

References:
  - [GitHub Docs — About code owners](https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

### `repo.contributing.present` — CONTRIBUTING guide present

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `contributing`

A CONTRIBUTING guide tells new contributors how to set up, test, and submit changes, reducing friction and inconsistent contributions.

References:
  - [GitHub Docs — Setting guidelines for repository contributors](https://docs.github.com/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)

### `repo.dependency-update-bot` — Dependency update bot configured

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-exists` · **fix**: template `renovate`

An automated update bot keeps dependencies current and surfaces security fixes as reviewable PRs instead of letting the project silently rot.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Dependency-Update-Tool

### `repo.editorconfig.present` — .editorconfig present

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `editorconfig`

An .editorconfig keeps indentation, charset, and line endings consistent across editors, preventing noisy whitespace-only diffs.

References:
  - [EditorConfig specification](https://editorconfig.org/)

### `repo.license.present` — LICENSE present

- **phase**: scaffold · **severity**: high · **effort**: small
- **detect**: `file-exists` · **fix**: template `license`

Without an explicit license, default copyright law leaves others with no right to use, copy, or contribute to the code, blocking adoption and collaboration.

References:
  - [SPDX License List](https://spdx.org/licenses/)
  - [GitHub Docs — Licensing a repository](https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

### `repo.lockfile.present` — Dependency lockfile committed

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-exists` · **fix**: —

A committed lockfile pins the exact dependency tree so every install and CI run is reproducible and resistant to surprise upstream changes.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Pinned-Dependencies

### `repo.readme.present` — README present

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-exists` · **fix**: template `readme`

A README is the entry point for every reader of the repository; its absence is the clearest signal of an unmaintained or hard-to-onboard project.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — Maintained

### `repo.security-policy.present` — SECURITY policy with a disclosure contact

- **phase**: scaffold · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: template `security`

A SECURITY.md with a disclosure contact gives researchers a private channel to report vulnerabilities instead of opening them publicly.

References:
  - [GitHub Docs — Adding a security policy to your repository](https://docs.github.com/code-security/getting-started/adding-a-security-policy-to-your-repository)

### `repo.toolchain-pinned` — Toolchain version pinned

- **phase**: scaffold · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `toolchain`

Pinning the language/runtime version keeps local, CI, and teammate environments identical and avoids "works on my machine" drift.

References:
  - [Twelve-Factor App — Dependencies](https://12factor.net/dependencies)


