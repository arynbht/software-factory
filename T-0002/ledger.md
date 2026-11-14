# T-0002 · Keep a customised factory.yml when init runs with --force

<!-- Written by the factory runtime from ledger.jsonl. Don't edit: changes are detected. -->

## Timeline

- 2026-11-14 02:31 intake: card drafted with 3 acceptance criteria; awaiting confirmation (arynbht@gmail.com)
- 2026-11-14 02:31 intake: intake confirmed; card sha256 7d9b6c26c858a5709cc4489378a9f25536d21f8a1a70975e22bcfd463a6507d8 (arynbht@gmail.com (--yes))
- 2026-11-14 02:32 route: assembly proposed; sha256 99c467602864a576e04bda1a3d140a8027504682ed7febade72054e59f7de04a; skills none; proof test-run; awaiting approval (factory router (for arynbht@gmail.com))
- 2026-11-14 02:32 route: route approved; assembly sha256 99c467602864a576e04bda1a3d140a8027504682ed7febade72054e59f7de04a (arynbht@gmail.com (--yes))
- 2026-11-14 02:32 isolate: worktree .worktrees/T-0002 · branch fix/t-0002 from origin/main (fb62ec8c2079) · port 5174 · db software_factory_dev_t0002 · env sha256 275531d16fb6e536b34dec3a43840858b56179aeed23a3604eef17c307fda0a7 (factory runtime (for arynbht@gmail.com))
- 2026-11-14 02:32 build: build started · skills spine only · budget 8 steps / 60k ctx · 27 repo file(s) in context · 47977 tokens · $0.27 (factory runtime (for arynbht@gmail.com))
- 2026-11-14 02:34 build: build paused: 1 thing(s) to ask about · commit b68aac70b0c3 · 381011 tokens · $0.54 (factory runtime (for arynbht@gmail.com))

## Plan

- 2026-11-14 02:32 1. In packages/cli/src/commands/init.ts, have runInit write .github/workflows/factory.yml through writeBeside(root, rel, buildWorkflow(phase), false), passing false for force on purpose. A missing file is then written from the template, an identical one is left alone, and a different one stays byte-for-byte unchanged while the template goes to .github/workflows/factory.factory.yml. Push the returned note ('<rel> exists; wrote <beside>: merge it by hand') onto `beside` so init's output names the sibling file.
- 2026-11-14 02:32 2. Update the doc comments in init.ts so they match the new behaviour. writeReplacing's comment should no longer call factory.yml a file --force replaces; it is now only reached through writeBeside's --force path. Add a one-line comment at the factory.yml call saying why it never takes --force: --force is the only way past an existing profile, and a person's workflow carries their required check name, action ref and gate. Leave the profile backup logic as it is.
- 2026-11-14 02:32 3. Add a new test to init.test.ts for A1. Run init once, overwrite factory.yml with custom content (a different check name, a local action and a looser gate), then run init with --force. Assert that factory.yml is byte-for-byte the custom content, that .github/workflows/factory.factory.yml equals the template (it contains 'name: factory' and the new 'gate:'), and that no factory.yml.bak is written.
- 2026-11-14 02:32 4. Add a new test to init.test.ts for A2. On a fresh dir, run init with --force and no factory.yml, and assert that factory.yml is written from the template and that factory.factory.yml does not exist. Also cover the case without --force, where factory.yml has been deleted after the first init, with the same assertions.
- 2026-11-14 02:32 5. Add a new test to init.test.ts for A3. Capture the process.stdout.write mock, run init --force against a customised factory.yml, and assert that the output matches /\.github\/workflows\/factory\.yml exists; wrote \.github\/workflows\/factory\.factory\.yml: merge it by hand/.
- 2026-11-14 02:32 6. Change the existing test '--force backs up what it replaces, and never resets waivers or evidence'. Its assertions that factory.yml now contains 'gate: build' and that factory.yml.bak holds the old workflow contradict A1 and the card. Replace them with: factory.yml equals the original workflow, and factory.factory.yml contains 'gate: build'. This edits an existing test, so the runtime will ask a person about it after the round.
- 2026-11-14 02:32 7. Add .changeset/init-keeps-factory-yml.md with a patch bump for "@arynbht/factory", written in one plain paragraph: init, with or without --force, no longer replaces a factory.yml that differs from the template. It writes the template beside it as factory.factory.yml for a person to merge, so a customised check name, action ref and gate survive a re-run.
- 2026-11-14 02:32 8. Run `pnpm action:build` and commit the rebuilt packages/action/dist/. Then run `pnpm run lint`, `pnpm run typecheck` and `pnpm run test` (at least `pnpm --filter @arynbht/factory test` for init.test.ts) to confirm they're green so the test-run proof can be produced.

## Decisions

- 2026-11-14 02:32 routed to docs, testing: docs (touches **/*.md (.changeset/*.md); skill native-writing triggers on **/*.md (.changeset/*.md)), testing (touches **/*.test.* (packages/cli/src/commands/init.test.ts))
- 2026-11-14 02:32 under the threshold, for the approver: workflow
- 2026-11-14 02:32 native-writing matched but isn't available (not locked, not synced, or blocked at sync)

## Stop-and-ask

- 2026-11-14 02:34 asked: protected_path: packages/cli/src/commands/init.test.ts — modifies a test that existed at base
- 2026-11-14 02:35 answered: allowed — The changed assertions encoded the old --force behaviour this card replaces; the new ones are stricter (factory.yml byte-for-byte kept, template beside it).
