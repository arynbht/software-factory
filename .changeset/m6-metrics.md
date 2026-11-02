---
"@arynbht/factory": minor
"@arynbht/factory-engine": minor
---

Add `factory metrics`: the four DORA keys computed from the GitHub API with no extra
services — deployment frequency (releases/week), lead time (PR open→merge median),
change failure rate (merged PRs that are reverts/hotfixes), and time to restore
(`incident`-labeled issue open→close median) — each with its proxy documented and
`null` when there isn't enough data. `--window <days>` and `--json` supported. The
Action also appends a per-lane pass snapshot to `.factory/history.jsonl` on each run
(hygiene trend); `loadHistory`/`laneCounts` read it back.
