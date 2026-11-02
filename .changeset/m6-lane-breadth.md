---
"@arynbht/factory-catalog": minor
"@arynbht/factory": patch
---

Complete the M6 control-catalog breadth and fix phase inference.

- Add the remaining lanes so all 14 are covered with ≥6 controls each:
  accessibility, legal, ux, and product (plus the previously-staged cloud, data,
  documentation, observability, performance lanes), and two more testing
  controls. 98 controls across 9 phase gates.
- Add the `risk-register` and `launch-checklist` templates and nine Claude prompt
  templates (build-vs-buy, nfrs, out-of-scope, data-inventory, retention-schedule,
  dsar-process, privacy-policy, copy-guidelines, accessibility-statement) so the
  newly-wired `template`/`claude` fixes resolve instead of silently no-opping.
- `factory status` no longer treats a phase gate that selects zero controls as a
  blocker: an empty gate is "undefined for this profile", not amber, so it never
  pins the inferred phase. With the early phases now populated, an empty repo
  correctly infers `discovery`.
