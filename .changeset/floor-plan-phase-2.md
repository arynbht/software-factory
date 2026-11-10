---
"@arynbht/factory-engine": minor
"@arynbht/factory-desktop": minor
---

Close the deep-audit loop and harden the swarm.

- **Incremental refresh**: each slice carries a content fingerprint; a refresh
  reuses unchanged slices verbatim and re-maps only what changed, skipping the
  reduce entirely when nothing moved — repeated refreshes are now cheap.
- **Verification pass**: a bounded reviewer agent prunes implausible cross-system
  edges so the inferred connections aren't trusted single-pass.
- **AI grounding**: the context packer injects a compact architecture summary from
  `.factory/floorplan.json`, so ADR / C4 / threat-model / explain-gaps are grounded
  in the repo's real systems and connections.
- **Profile enrichment**: the Profile tab surfaces the swarm's detected
  type/stack/flags/phase as an "Apply suggestions" banner that fills the form for
  review (never auto-written — Claude drafts, humans sign).
