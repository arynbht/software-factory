# UX & UI



Design systems, key-flow states, responsiveness, and user feedback.



6 control(s).



### `ux.copy.guidelines` — Copy and tone guidelines recorded

- **phase**: design · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: claude `copy-guidelines`

A short voice and tone guide keeps product copy consistent and on-brand across contributors, so the product speaks with one voice as more people write it.

References:
  - [Material Design — Writing](https://m2.material.io/design/communication/writing.html)

### `ux.design-system.adopted` — Design tokens or component library adopted

- **phase**: design · **severity**: low · **effort**: medium
- **detect**: `file-matches` · **fix**: —

A shared token or component layer keeps the UI consistent and makes visual changes cheap, because a single source of truth drives colours, spacing, and components across the whole product.

References:
  - [Design Tokens (W3C Community Group)](https://www.w3.org/community/design-tokens/)

### `ux.feedback.channel` — User feedback channel exists

- **phase**: operate · **severity**: low · **effort**: small
- **detect**: `manual` · **fix**: —

A standing channel for user feedback turns real usage into a steady stream of improvements, instead of leaving the team guessing at what to fix next.

References:
  - [NN/g — Listening to users](https://www.nngroup.com/articles/listening-to-users/)

### `ux.flows.wireframes` — Wireframes for key flows linked

- **phase**: design · **severity**: low · **effort**: small
- **detect**: `manual` · **fix**: —

Wireframing the key flows surfaces interaction problems early, when they are cheap to fix, rather than after they are expensive to change in code.

References:
  - [Nielsen Norman Group — Wireframing](https://www.nngroup.com/articles/wireflows/)

### `ux.responsive.breakpoints` — Responsive breakpoints defined

- **phase**: design · **severity**: low · **effort**: small
- **detect**: `file-matches` · **fix**: —

Explicit breakpoints keep the layout usable across the range of device sizes users actually bring, instead of breaking at widths no one tested.

References:
  - [web.dev — Responsive design basics](https://web.dev/articles/responsive-web-design-basics)

### `ux.states.designed` — Empty, loading, error, and offline states designed

- **phase**: design · **severity**: medium · **effort**: medium
- **detect**: `manual` · **fix**: —

Real UIs spend much of their life in non-happy states; designing the empty, loading, error, and offline states prevents experiences that feel broken.

References:
  - [NN/g — Design for the states](https://www.nngroup.com/articles/skeleton-screens/)


