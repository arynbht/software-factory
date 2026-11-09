# Legal & compliance



Licensing, privacy, data protection, and regulatory obligations.



7 control(s).



### `legal.cookie.consent` — Cookie consent for EU users with tracking

- **phase**: launch · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: —

EU law requires prior informed consent for non-essential tracking cookies, so a consent mechanism must be in place before tracking EU users rather than relying on implied or post-hoc consent.

References:
  - [ePrivacy Directive (cookies)](https://gdpr.eu/cookies/)

### `legal.data.inventory` — Data inventory and map maintained

- **phase**: requirements · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: claude `data-inventory`

You cannot protect or delete data you have not inventoried; Art. 30 requires records of processing, so maintaining a data inventory and map is the foundation for every downstream privacy obligation.

References:
  - [GDPR Art. 30 — Records of processing](https://gdpr-info.eu/art-30-gdpr/)

### `legal.data.retention` — Retention schedule and deletion job defined

- **phase**: requirements · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: claude `retention-schedule`

Storage limitation requires keeping PII only as long as needed, with an actual deletion mechanism; a documented retention schedule and a working deletion job turn that principle into enforced practice.

References:
  - [GDPR Art. 5(1)(e) — Storage limitation](https://gdpr-info.eu/art-5-gdpr/)

### `legal.dsar.process` — DSAR (data subject request) process documented

- **phase**: requirements · **severity**: medium · **effort**: medium
- **detect**: `manual` · **fix**: claude `dsar-process`

Data subjects have access and erasure rights; a documented DSAR process keeps responses within statutory deadlines and ensures requests are handled consistently rather than ad hoc.

References:
  - [GDPR Ch. 3 — Rights of the data subject](https://gdpr-info.eu/chapter-3/)

### `legal.license-summary` — Third-party license summary

- **phase**: harden · **severity**: medium · **effort**: small
- **detect**: `file-exists`, `reviewed` · **fix**: claude `license-summary`

Shipping software means redistributing its dependencies, each under its own license with its own obligations (attribution, source offer, copyleft reach). A grouped summary of those licenses confirms the project has the right to ship and surfaces any term that needs action before release; a drafted summary still needs a human to verify it against the actual dependency tree.

References:
  - [SPDX License List](https://spdx.org/licenses/)
  - [REUSE Specification](https://reuse.software/spec/)

### `legal.privacy.policy` — Privacy policy published

- **phase**: launch · **severity**: high · **effort**: small
- **detect**: `file-matches`, `reviewed` · **fix**: claude `privacy-policy`

Users must be told what data is collected and why; a published privacy policy satisfies that duty, and a draft still needs legal review before it goes live.

References:
  - [GDPR Arts. 13–14 — Information to be provided](https://gdpr-info.eu/art-13-gdpr/)
  - [California CPPA](https://cppa.ca.gov/)

### `legal.terms.published` — Terms of service published

- **phase**: launch · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: —

Terms set the contract and liability limits between the product and its users; publishing them establishes the agreed rules of engagement and reduces legal exposure.

References:
  - [US FTC — Terms & disclosures guidance](https://www.ftc.gov/business-guidance/advertising-marketing/online-advertising-marketing)


