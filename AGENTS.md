# AGENTS.md

<!-- Written by `factory init`. Everything above "This repo" is the factory's
contract, the same in every factory repo; the "This repo" section is yours to edit.
The judge reads this file from the base branch and blocks a change that breaks it. -->

This repo is built with the software factory. These rules apply to every agent that
works in it (Claude Code, Codex, Cursor) and to the factory's own agents.

## Before anything

Run `factory doctor`. If it fails, do what it says (often
`factory skills sync`) before starting work.

## Every task starts with /factory

In Claude Code: `/factory <what you want>` or `/factory #<issue>`.
Anywhere else, use the `factory task` commands the skill uses. Don't change
files in this checkout on the default branch: each task gets its own worktree and
branch, and the change reaches the default branch only through a reviewed PR.

## The beats

0. **sync**: `factory doctor && factory skills sync`. Machine and skills ready, pinned and verified.
1. **intake**: a task card with acceptance criteria, each saying how it's verified. A person confirms it.
2. **route**: the router picks sectors, at most four skills, the judge's checks and the proof. A person approves the assembly.
3. **isolate**: a worktree in `.worktrees/<id>` on its own branch from the default branch, with its own port and database.
4. **build**: one agent plans, then builds, inside the worktree; it stops and asks on the triggers below.
5. **prove**: a tool produces the proof; the agent never describes it.
6. **judge**: a clean clone of base plus the change. Deterministic checks first, then a scoped review.
7. **ship**: a draft PR written from the card, the ledger and the proof.
8. **close**: after a person merges, the ledger is sealed, the worktree removed and the metrics row appended.

The ledger in `.factory/tasks/<id>/` is the record and the resume point:
`factory task resume <id>`. Only the runtime writes it.

## Protected paths

A task never edits these. The judge marks any change to them as needing a person:

- `.factory/**`
- `.claude/settings.json`
- `.claude/settings.local.json`
- `.codex/**`
- `.cursor/hooks.json`
- `.cursor/rules/**`
- `.gemini/settings.json`
- `.github/hooks/**`
- `.github/workflows/**`
- `.github/actions/**`
- `lefthook.yml`
- `lefthook.yaml`
- `.lefthook.yml`
- `.pre-commit-config.yaml`
- `.husky/**`
- `commitlint.config.*`
- `**/eslint.config.*`
- `**/.eslintrc*`
- `**/.prettierrc*`
- `**/prettier.config.*`
- `**/biome.json`
- `**/biome.jsonc`
- `**/ruff.toml`
- `**/.ruff.toml`
- `**/.flake8`
- `**/.pylintrc`
- `**/mypy.ini`
- `**/.golangci.*`
- `**/clippy.toml`
- `**/.clippy.toml`
- `**/rustfmt.toml`
- `**/tsconfig*.json`
- `**/.editorconfig`
- tests that already exist (add new tests instead)
- new `eslint-disable`, `@ts-ignore`, `# noqa` or similar suppressions

## Stop and ask

Pause and ask the person before:

- adding a dependency
- a schema change or a migration
- touching a protected path, or deleting or changing an existing test
- any change to lint config, CI config or `.factory/**`
- going past the plan's step budget
- treating an acceptance criterion as impossible

## Proof and review

- Proof comes from tools: before and after screenshots with axe for UI work, the
  test run for everything else. It is never written up by the agent.
- The judge works on a clean clone. Lint, typecheck and tests run first; a check
  that's red on the base too is reported as pre-existing. Then comes a review where
  only three things block: a defect, a breach of this file, CONSTRAINTS.md or
  DESIGN.md, and an unmet acceptance criterion. Everything else is a suggestion.
- Blocking findings go back to the agent at most twice. After that a person decides.

## People merge

The factory opens draft PRs. It never merges, and neither does any agent.

## This repo

- **software-factory**: monorepo, phase scaffold
- Stack: node, typescript, pnpm, electron
- Flags: open-source, distributes-binaries, uses-ai
- Commands: install `pnpm install` · lint `pnpm run lint` · typecheck `pnpm run typecheck` · test `pnpm run test`

<!-- House patterns, naming, where things live: add them here. The judge holds changes to them. -->

- Where things live: `packages/catalog` (controls, profile schema), `packages/engine`
  (detectors, GitHub, AI), `packages/runtime` (the task beats), `packages/registry`
  (skills), `packages/cli` (the `factory` command), `packages/action` (the GitHub
  Action, bundled), `apps/desktop` (the Electron shell).
- `packages/action/dist/` is generated. A change under `packages/engine`, `packages/cli`,
  `packages/catalog` or `packages/runtime/src` needs `pnpm action:build`, with the
  rebuilt `dist/` committed, or CI's bundle check fails.
- A change to a published package needs a changeset in `.changeset/`
  (`@arynbht/factory`, `@arynbht/factory-engine`, `@arynbht/factory-runtime`, …).
- Commit and PR titles are conventional commits; the subject starts lowercase and the
  header is at most 72 characters.
- Comments and messages are plain sentences that say why, in the voice of the
  surrounding code. Match the file's naming and comment density.
