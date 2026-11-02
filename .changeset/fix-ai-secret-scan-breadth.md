---
"@arynbht/factory-engine": patch
---

Broaden the AI-context secret guard. The content scan now also catches Stripe
keys (`sk_live_`/`rk_live_`), JWTs, service-account/cloud-credential JSON,
Azure `AccountKey=` connection strings, database URLs with an inline password,
and unquoted `key=value` secret assignments. The path denylist gains certificate
and credential-store extensions (`.crt/.cer/.der/.p8/.p7b/.kdbx/.ovpn`),
`kubeconfig`, and the `.aws/.ssh/.kube/.gnupg/.docker` directories. Binary files
(detected by a NUL byte) are skipped entirely, since a raw-binary secret matches
no text regex. The module now documents that it is best-effort — run gitleaks
over the candidate set when stronger assurance is required.
