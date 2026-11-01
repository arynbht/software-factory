# Contributing

Thanks for your interest in the Software Factory.

## Prerequisites

- Node 22 LTS (see `.nvmrc`/`.node-version`)
- pnpm (pinned via `packageManager` in `package.json`; run `corepack enable`)

## Setup

```bash
corepack enable
pnpm install
```

`pnpm install` also installs the git hooks (via `lefthook`).

## Everyday commands

| Command          | What it does                                                |
| ---------------- | ----------------------------------------------------------- |
| `pnpm typecheck` | Type-check all packages (project references)                |
| `pnpm build`     | Build all packages                                          |
| `pnpm lint`      | ESLint across the workspace                                 |
| `pnpm format`    | Check formatting with Prettier (`pnpm format:write` to fix) |
| `pnpm test`      | Run the Vitest suite                                        |

## Commits

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/)
(e.g. `feat(engine): add file-exists detector`). This is enforced by commitlint in
a `commit-msg` hook. Secrets are blocked pre-commit by gitleaks.

## Changesets

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

See [`.changeset/README.md`](./.changeset/README.md).

## Pull requests

- One PR per task; keep them small and reviewable.
- CI must be green (`typecheck`, `lint`, `test`, `build`).
- Branch protection requires a PR and a passing `ci` check to merge to `main`.
