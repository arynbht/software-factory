# Accessibility



WCAG conformance, automated and manual accessibility checks on key flows.



6 control(s).



### `a11y.ci.automated-checks` — Automated accessibility checks in CI (axe/Lighthouse)

- **phase**: build · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: —

Automated checks catch the most common WCAG failures on every PR cheaply, shifting accessibility regressions left before they reach users.

References:
  - [Deque axe](https://www.deque.com/axe/)
  - [Lighthouse accessibility](https://developer.chrome.com/docs/lighthouse/accessibility/)

### `a11y.contrast.enforced` — Color contrast enforced in design tokens

- **phase**: design · **severity**: medium · **effort**: small
- **detect**: `manual` · **fix**: —

Encoding contrast ratios into design tokens prevents low-contrast UI from shipping, turning a per-screen judgement call into a reusable guarantee.

References:
  - [WCAG 2.2 — Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)

### `a11y.keyboard.manual-pass` — Keyboard-only manual pass recorded

- **phase**: build · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: —

Many access barriers only surface in a real keyboard-only pass; it is human judgement and ages out, so it must be re-recorded rather than assumed.

References:
  - [WCAG 2.2 — Keyboard Accessible](https://www.w3.org/WAI/WCAG22/Understanding/keyboard-accessible)

### `a11y.screen-reader.pass` — Screen-reader pass on key flows recorded

- **phase**: build · **severity**: high · **effort**: large
- **detect**: `manual` · **fix**: —

Screen-reader testing on core journeys catches semantics and labeling issues that automation misses; it is human judgement and must be recorded as evidence.

References:
  - [WebAIM — Screen Reader Testing](https://webaim.org/articles/screenreader_testing/)

### `a11y.statement.published` — Accessibility statement page published

- **phase**: launch · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: claude `accessibility-statement`

A public accessibility statement is expected by the EAA and ADA and tells users how to report barriers, giving them a clear channel to raise access problems.

References:
  - [European Accessibility Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882)
  - [ADA Title II web rule (2024)](https://www.ada.gov/resources/2024-03-08-web-rule/)

### `a11y.target.stated` — Accessibility target stated (WCAG 2.2 AA)

- **phase**: design · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: —

Naming a concrete conformance target makes accessibility testable instead of aspirational: teams can verify against it rather than debating what "accessible" means.

References:
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/)


