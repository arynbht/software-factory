# Security & supply chain



Secret scanning, SAST, dependency and container scanning, SBOM, and threat modelling.



10 control(s).



### `sec.dependabot-security-updates` — Dependabot security updates enabled

- **phase**: harden · **severity**: medium · **effort**: small
- **detect**: `github-api` · **fix**: github-setting `dependabot-security-updates`

Dependabot security updates open PRs that bump vulnerable dependencies to a patched version automatically, closing known CVEs without manual tracking.

References:
  - [GitHub Docs — About Dependabot security updates](https://docs.github.com/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates)

### `sec.dependency-scan.ci` — Dependency vulnerability scan in CI

- **phase**: harden · **severity**: high · **effort**: small
- **detect**: `any-of` · **fix**: merge-yaml `.github/workflows/ci.yml`

Scanning dependencies for known vulnerabilities on every build surfaces exploitable CVEs in third-party code while they are cheap to fix.

References:
  - [OSV-Scanner](https://google.github.io/osv-scanner/)
  - [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

### `sec.push-protection` — Secret scanning push protection enabled

- **phase**: harden · **severity**: medium · **effort**: small
- **detect**: `github-api` · **fix**: github-setting `secret-scanning-push-protection`

Push protection blocks commits containing recognised secrets at push time, stopping credential leaks before they ever reach the remote.

References:
  - [GitHub Docs — Push protection for repositories](https://docs.github.com/code-security/secret-scanning/push-protection-for-repositories-and-organizations)

### `sec.sast.ci` — SAST runs in CI

- **phase**: harden · **severity**: high · **effort**: medium
- **detect**: `any-of` · **fix**: merge-yaml `.github/workflows/ci.yml`

Static analysis in CI finds injection, unsafe-API, and other vulnerability patterns automatically on every change, before they ship.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — SAST
  - [NIST SSDF](https://csrc.nist.gov/projects/ssdf)

### `sec.sbom.ci` — SBOM generated in CI

- **phase**: harden · **severity**: low · **effort**: medium
- **detect**: `any-of` · **fix**: merge-yaml `.github/workflows/ci.yml`

A per-build software bill of materials lets you answer "are we affected?" for a new CVE in seconds instead of auditing the dependency tree by hand.

References:
  - [CycloneDX](https://cyclonedx.org/)
  - [SLSA specification](https://slsa.dev/spec)

### `sec.scorecard.score` — OpenSSF Scorecard "Maintained" check above threshold

- **phase**: harden · **severity**: low · **effort**: medium
- **detect**: `scorecard` · **fix**: —

OpenSSF Scorecard's "Maintained" check is a comparable signal that the project is actively maintained (recent commits/releases), a strong proxy for whether security issues will be addressed. Other checks can be gated as separate controls.

References:
  - [OpenSSF Scorecard](https://github.com/ossf/scorecard)

### `sec.secret-scanning.ci` — Secret scanning runs in CI

- **phase**: harden · **severity**: medium · **effort**: small
- **detect**: `any-of` · **fix**: merge-yaml `.github/workflows/ci.yml`

A CI secret scan is a backstop for anything that slips past local hooks and catches secrets introduced by contributors without the hooks installed.

References:
  - [gitleaks — GitHub Action](https://github.com/gitleaks/gitleaks-action)

### `sec.secret-scanning.pre-commit` — Secret scanning runs before commit

- **phase**: scaffold · **severity**: high · **effort**: small
- **detect**: `file-matches` · **fix**: template `lefthook`

Catching leaked credentials before they are pushed is far cheaper than rotating them after exposure; leaked secrets are a leading cause of repo compromise.

References:
  - [gitleaks](https://github.com/gitleaks/gitleaks)

### `sec.threat-model` — Threat model documented and current

- **phase**: harden · **severity**: high · **effort**: large
- **detect**: `manual` · **fix**: claude `threat-model`

A current threat model forces explicit thinking about how the system can be attacked; it is human judgement, so it is satisfied by reviewed evidence rather than an automated check and ages out via valid-for.

References:
  - [OWASP — Threat Modeling](https://owasp.org/www-community/Threat_Modeling)
  - [NIST SSDF](https://csrc.nist.gov/projects/ssdf)

### `sec.vulnerability-alerts` — Dependency vulnerability alerts enabled

- **phase**: harden · **severity**: medium · **effort**: small
- **detect**: `github-api` · **fix**: github-setting `vulnerability-alerts`

Vulnerability alerts notify maintainers when a dependency has a known advisory, which is the trigger for prioritising a security update.

References:
  - [GitHub Docs — About Dependabot alerts](https://docs.github.com/code-security/dependabot/dependabot-alerts/about-dependabot-alerts)


