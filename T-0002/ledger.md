# T-0002 · Keep a customised factory.yml when init runs with --force

<!-- Written by the factory runtime from ledger.jsonl. Don't edit: changes are detected. -->

## Timeline

- 2026-11-14 02:31 intake: card drafted with 3 acceptance criteria; awaiting confirmation (arynbht@gmail.com)
- 2026-11-14 02:31 intake: intake confirmed; card sha256 7d9b6c26c858a5709cc4489378a9f25536d21f8a1a70975e22bcfd463a6507d8 (arynbht@gmail.com (--yes))
- 2026-11-14 02:32 route: assembly proposed; sha256 99c467602864a576e04bda1a3d140a8027504682ed7febade72054e59f7de04a; skills none; proof test-run; awaiting approval (factory router (for arynbht@gmail.com))
- 2026-11-14 02:32 route: route approved; assembly sha256 99c467602864a576e04bda1a3d140a8027504682ed7febade72054e59f7de04a (arynbht@gmail.com (--yes))

## Decisions

- 2026-11-14 02:32 routed to docs, testing: docs (touches **/*.md (.changeset/*.md); skill native-writing triggers on **/*.md (.changeset/*.md)), testing (touches **/*.test.* (packages/cli/src/commands/init.test.ts))
- 2026-11-14 02:32 under the threshold, for the approver: workflow
- 2026-11-14 02:32 native-writing matched but isn't available (not locked, not synced, or blocked at sync)
