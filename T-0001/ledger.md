# T-0001 · Keep a customised factory.yml when init runs with --force

<!-- Written by the factory runtime from ledger.jsonl. Don't edit: changes are detected. -->

## Timeline

- 2026-11-14 00:16 intake: card drafted with 3 acceptance criteria; awaiting confirmation (arynbht@gmail.com)
- 2026-11-14 00:16 intake: intake confirmed; card sha256 f02c874b61a40b483412136c4a16589f4941f09ac7decb50397148d0aa15a2d1 (arynbht@gmail.com (--yes))
- 2026-11-14 00:16 route: assembly proposed; sha256 1f8defeaef3ed98c583f157db8760519ad5cb29d3981b8b16d17e4549b0f068a; skills none; proof test-run; awaiting approval (factory router (for arynbht@gmail.com))
- 2026-11-14 00:16 route: route approved; assembly sha256 1f8defeaef3ed98c583f157db8760519ad5cb29d3981b8b16d17e4549b0f068a (arynbht@gmail.com (--yes))
- 2026-11-14 00:16 isolate: worktree .worktrees/T-0001 · branch fix/t-0001 from origin/main (eb93ad1d9bb4) · port 5174 · db software_factory_dev_t0001 · env sha256 81343de0887e2032141f9d59b09ab10146e68bef0eb4a4ebab3f8448df22e655 (factory runtime (for arynbht@gmail.com))
- 2026-11-14 00:16 build: build started · skills spine only · budget 8 steps / 60k ctx · 25 repo file(s) in context · 45126 tokens · $0.24 (factory runtime (for arynbht@gmail.com))
- 2026-11-14 00:16 build: build done · commit eb93ad1d9bb4 · 0 file(s) this round · 41919 tokens · $0.24 · I haven't changed anything. Step 1 of the approved plan says to get the owner's approval first, and the operating rules say to stop and ask before changing an existing test. (factory runtime (for arynbht@gmail.com))
- 2026-11-14 00:17 prove: proof failed · test-run (factory runtime (for arynbht@gmail.com))
- 2026-11-14 00:19 build: build done · commit 18dcd99561bc · 4 file(s) this round · 279276 tokens · $0.39 · I'm stopping here without making the fix. Two things need you, and I've left a stray change in `packages/action/dist/` that I couldn't undo. (factory runtime (for arynbht@gmail.com))
- 2026-11-14 00:20 prove: proof passed · test-run (factory runtime (for arynbht@gmail.com))

## Plan

- 2026-11-14 00:16 1. Before any edit, stop and ask the owner to approve changing the existing test '--force backs up what it replaces, and never resets waivers or evidence' in packages/cli/src/commands/init.test.ts. Under this fix, init --force with a new phase leaves factory.yml as it is (still 'gate: scaffold'), writes the 'gate: build' template to .github/workflows/factory.factory.yml and makes no factory.yml.bak. So the current assertions that factory.yml contains 'gate: build' and that factory.yml.bak equals the old workflow must change.
- 2026-11-14 00:16 2. In packages/cli/src/commands/init.ts, move the 'write beside' logic out of writeBeside into a helper, writeSibling(root, rel, content), that never replaces a file. A missing file is written (creating its directory), an identical file is left alone, and a different file is kept byte-for-byte while the content goes to name.factory.ext. It returns the note `${rel} exists; wrote ${besideRel}: merge it by hand`. writeBeside keeps its current behaviour: with force it still calls writeReplacing, and without force it calls writeSibling.
- 2026-11-14 00:16 3. In runInit, replace the writeReplacing(root, '.github/workflows/factory.yml', buildWorkflow(...), flags.force) call with writeSibling(root, '.github/workflows/factory.yml', buildWorkflow(draft.phase ?? 'build')), and push its note onto `beside`. If writeReplacing then has only the one caller, writeBeside's force branch, inline it there. Update its doc comment so it no longer names factory.yml, and add a comment at the call site citing spec §12: a person's factory.yml is never replaced, with or without --force.
- 2026-11-14 00:16 4. Update the agreed existing test in init.test.ts: after the --force run, factory.yml is still exactly the original `workflow` string, factory.factory.yml contains 'gate: build', and factory.yml.bak doesn't exist. The waiver, evidence and profile assertions stay as they are.
- 2026-11-14 00:16 5. Add a test for A1 and A3 to init.test.ts. Run init, overwrite factory.yml with custom content (e.g. a 'factory' check name and a local action), then run init with force: true while capturing stdout. Assert factory.yml is byte-for-byte unchanged, factory.factory.yml equals the template (contains 'name: factory' and the gate), and the output contains '.github/workflows/factory.factory.yml' and 'merge it by hand'. Then run init with --force a second time and check factory.yml is still unchanged.
- 2026-11-14 00:16 6. Add a test for A2 to init.test.ts. On a fresh repo, init without --force writes factory.yml from the template with no factory.factory.yml. Then delete factory.yml (leaving the profile in place) and run init with --force: factory.yml is written from the template, and there is still no sibling or .bak.
- 2026-11-14 00:16 7. Add .changeset/init-keeps-factory-yml.md with '"@arynbht/factory": patch', saying that init (with or without --force) no longer replaces a factory.yml that differs from the template: it writes the template beside it as .github/workflows/factory.factory.yml and says to merge it by hand.
- 2026-11-14 00:16 8. Run `pnpm --filter @arynbht/factory test`, then lint and typecheck, and fix any failures. Then run `pnpm action:build` and include the rebuilt packages/action/dist in the change. Don't touch any protected path.

## Decisions

- 2026-11-14 00:16 routed to docs, testing: docs (touches **/*.md (.changeset/*.md); skill native-writing triggers on **/*.md (.changeset/*.md)), testing (touches **/*.test.* (packages/cli/src/commands/init.test.ts))
- 2026-11-14 00:16 under the threshold, for the approver: workflow
- 2026-11-14 00:16 native-writing matched but isn't available (not locked, not synced, or blocked at sync)

## Proof

- 2026-11-14 00:17 tests failed (pnpm run test, exit 1) · new tests: none
- 2026-11-14 00:17 output: …20-%20Dev/.worktrees/T-0001/node_modules/.pnpm/vite@5.4.21_@types+node@22.20.5/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:[2m64300:26[22m[39m [90m [2m❯[22m ../../../Software%20Factory%20-%20Dev/.worktrees/T-0001/node_modules/.pnpm/vite@5.4.21_@types+node@22.20.5/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:[2m64439:39[22m[39m [31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/61]⎯[22m[39m
- 2026-11-14 00:17 evidence: the test run on the evidence branch: https://github.com/arynbht/software-factory/blob/evidence/T-0001/test-run.txt?raw=true
- 2026-11-14 00:20 tests passed (pnpm run test, exit 0) · new tests: none
- 2026-11-14 00:20 output: …: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it
- 2026-11-14 00:20 evidence: the test run on the evidence branch: https://github.com/arynbht/software-factory/blob/evidence/T-0001/test-run.txt?raw=true
