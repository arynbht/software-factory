# Product & launch



Discovery briefs, requirements, risk registers, and launch readiness.



7 control(s).



### `product.discovery.brief` — Discovery brief with success metrics and kill criteria

- **phase**: discovery · **severity**: medium · **effort**: medium
- **detect**: `file-exists` · **fix**: claude `brief`

Capturing the problem, target users, success metrics, and kill criteria before building forces a clear hypothesis and a pre-agreed way to tell whether the work is succeeding or should be stopped.

References:
  - [Marty Cagan — Product Discovery](https://www.svpg.com/product-discovery/)

### `product.launch.checklist` — Launch checklist and go/no-go recorded

- **phase**: launch · **severity**: medium · **effort**: small
- **detect**: `file-exists` · **fix**: template `launch-checklist`

A go/no-go launch checklist catches readiness gaps across the system before release, turning an implicit "ship it" into an explicit, reviewable decision.

References:
  - [Google SRE — Launch Coordination](https://sre.google/sre-book/reliable-product-launches/)

### `product.requirements.nfrs` — Non-functional requirements captured as numbers

- **phase**: requirements · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: claude `nfrs`

Quantified non-functional requirements such as latency, throughput, and availability are testable, whereas prose like "fast" or "reliable" cannot be verified or held to account.

References:
  - [ISO/IEC 25010 — Quality model](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010)

### `product.risk.register` — Risk register started

- **phase**: discovery · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: template `risk-register`

Tracking the top risks with their likelihood, impact, and mitigation keeps known threats visible and owned rather than rediscovered late, when they are more expensive to address.

References:
  - [PMI — Risk Register](https://www.pmi.org/learning/library/risk-register-6813)

### `product.scope.out-of-scope` — Out-of-scope list recorded

- **phase**: requirements · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: claude `out-of-scope`

An explicit list of non-goals prevents scope creep by making it clear what is deliberately not being built, so added work becomes a visible decision rather than a silent drift.

References:
  - [Basecamp — Shape Up (Scoping)](https://basecamp.com/shapeup/2.2-chapter-08)

### `product.stories.acceptance` — User stories with acceptance criteria

- **phase**: requirements · **severity**: medium · **effort**: medium
- **detect**: `file-exists` · **fix**: claude `stories`

Testable acceptance criteria turn user intent into verifiable scope, giving a shared, unambiguous definition of done that both builders and reviewers can check against.

References:
  - [Mike Cohn — User Stories](https://www.mountaingoatsoftware.com/agile/user-stories)

### `product.survey.build-vs-buy` — Build-vs-buy survey recorded

- **phase**: discovery · **severity**: low · **effort**: small
- **detect**: `manual` · **fix**: claude `build-vs-buy`

Recording the build-vs-buy decision and the alternatives considered before committing engineering effort documents a deliberate trade-off, so it is satisfied by reviewed evidence of that judgement.

References:
  - [ThoughtWorks — Build vs Buy](https://www.thoughtworks.com/insights/blog/build-vs-buy)


