# Data



Schema migrations, PII classification, encryption, and retention.



6 control(s).



### `data.analytics-taxonomy` — Analytics event taxonomy documented

- **phase**: build · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

A documented event taxonomy keeps analytics trustworthy; without one, every team invents its own names and the funnel becomes unanalysable.

References:
  - [Segment — Analytics tracking plan](https://segment.com/academy/collecting-data/how-to-create-a-tracking-plan/)

### `data.backup-restore-drill` — Data backup restore drill performed

- **phase**: operate · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: —

Restoring real data in a drill is the only proof the backup strategy works; it ages out via valid-for so it is repeated, not assumed.

References:
  - [Google SRE Book — Data Integrity](https://sre.google/sre-book/data-integrity/)

### `data.encryption-verified` — Encryption at rest and in transit verified

- **phase**: harden · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: —

Encryption in transit and at rest is table stakes for any system holding user data; this is satisfied by evidence that both are actually on.

References:
  - [OWASP — Transport Layer Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)

### `data.migrations-versioned` — Schema migrations versioned and reversible

- **phase**: build · **severity**: high · **effort**: medium
- **detect**: `file-exists` · **fix**: —

Versioned, reversible migrations make schema change safe to deploy and roll back; ad-hoc SQL against production is how data gets lost.

References:
  - [Twelve-Factor App — Admin processes](https://12factor.net/admin-processes)

### `data.pii-classified` — PII columns classified

- **phase**: architecture · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: —

You cannot protect, retain, or delete personal data you have not catalogued; classifying PII is the prerequisite for every privacy obligation.

References:
  - [GDPR — Art. 30 Records of processing](https://gdpr-info.eu/art-30-gdpr/)

### `data.retention-jobs` — Retention and deletion jobs implemented

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `manual` · **fix**: —

Keeping data forever is a liability; automated retention and deletion jobs enforce the storage-limitation principle instead of trusting memory.

References:
  - [GDPR — Art. 5(1)(e) Storage limitation](https://gdpr-info.eu/art-5-gdpr/)


