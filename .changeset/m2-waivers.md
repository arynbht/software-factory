---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Add waivers. A waiver (`.factory/waivers.yml`: control, reason, owner, created,
expires) turns a non-passing control into the new `waived` status while active;
an expired waiver has no effect (the control stays failing). `factory waive
<control> --reason --expires [--owner]` records one, the audit reports `waived`
and warns about waivers expiring within 30 days, and gates treat waived controls
as satisfied.
