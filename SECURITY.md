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
