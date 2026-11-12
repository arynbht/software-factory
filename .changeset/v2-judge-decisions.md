---
"@arynbht/factory-catalog": minor
"@arynbht/factory-engine": minor
"@arynbht/factory": patch
"@arynbht/factory-runtime": minor
---

Apply the judge decisions: the coverage floor ratchets (profile `quality.coverage`,
else a baseline recorded in `.factory/quality.json` that only moves up) and fails in
the judge when configured coverage writes no summary; `reviewed` finds drafts by their
header and requires every draft for the task to be reviewed; the judge sweeps stale
clones, disables the target repo's hooks, runs tests before reading coverage, and
won't pass a non-Node repo on checks that are red at base too.
