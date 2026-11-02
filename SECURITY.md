# Security Policy

## Supported versions

The project is pre-1.0 and under active development. Only the latest `main` is
supported until a `1.0` release is tagged.

| Version             | Supported |
| ------------------- | --------- |
| `main` (unreleased) | ✅        |
| older tags          | ❌        |

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public issue for a
vulnerability.

- Preferred: open a [GitHub private security advisory](https://github.com/arynbht/software-factory/security/advisories/new).
- Alternatively, email **aryan.bhatia@pilotship.io** with details and, if
  possible, a proof of concept.

You can expect an acknowledgement within 7 days. Please allow reasonable time for
a fix before any public disclosure.

## Handling of secrets

The factory never writes tokens to `.factory/` or logs; secrets live only in the
environment (CLI/CI) or the desktop app's secure store. If you believe a secret
was committed, treat it as compromised and rotate it immediately.

Values that reference a control (`.factory/waivers.yml` and `.factory/evidence.yml`
`control:` fields) are validated against the control-id shape at load time, so an
arbitrary string can't be smuggled into the pull-request / status-issue comment the
Action posts.

## Using the GitHub Action safely

The Action ships a committed bundle (`packages/action/dist/`). The `SOURCE_SHA256`
staleness guard only runs in this repo's CI — it is **not** a runtime integrity
check for consumers. To protect yourself against a tampered tag or bundle, **pin the
Action to a full commit SHA** rather than a mutable tag:

```yaml
# Prefer this:
- uses: arynbht/software-factory/packages/action@<commit-sha>
# over a mutable tag like @v1.
```

The scaffolded `factory.yml` grants least privilege per trigger: pull-request runs
get `pull-requests: write` (to post the review comment) and nothing else;
scheduled/push runs get `issues: write` (to maintain the status issue). The audit
must never execute repository-authored code with the default token.
