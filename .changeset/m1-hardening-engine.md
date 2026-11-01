---
"@arynbht/factory-engine": patch
---

Harden the engine after the M1 review: `getByPath` now matches only own data
properties and in-range array indices (no prototype keys like `toString`, no
array `length`/methods), preventing false-pass structured-path checks;
`evaluateControl` no longer crashes the whole run on an unreadable evidence file;
context memos evict rejected promises instead of caching and amplifying them;
`branch-protection` requires a merge-gating ruleset rule (not a lone
`non_fast_forward`); unparseable `valid-for` fails closed; and `parseRepoSlug`
rejects non-bare URLs with extra path segments.
