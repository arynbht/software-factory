---
"@arynbht/factory-engine": patch
---

The secret filter no longer mistakes code that refers to a secret for the secret itself. A value that names another secret (`token: auth.token`, `apiKey: this.config.apiKey`) or a lone identifier in an object literal (`token: explicit,`) is code, so the judge's AI review and the AI context now see those files instead of skipping them. Quoted values and dotted values that don't end in a secret's name are flagged as before.
