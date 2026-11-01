# 5. TypeScript everywhere, pnpm workspaces, Node 22 LTS

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

One solo developer maintains an engine, a CLI, a GitHub Action, a Claude Code
skill, and an Electron app. Using different languages or package managers per
surface multiplies the maintenance burden. What language, package manager, and
runtime should the monorepo standardise on?

## Considered Options

- **TypeScript everywhere, pnpm workspaces, Node 22 LTS.**
- Mixed stacks per surface (e.g. Go CLI, TS app).
- npm or Yarn workspaces instead of pnpm.

## Decision Outcome

Chosen: **TypeScript across all packages**, **pnpm workspaces** for the monorepo,
and **Node 22 LTS** as the runtime (pinned in `.nvmrc`/`.node-version` and
`engines`). TypeScript uses strict mode with project references; the package
manager version is pinned via `packageManager` in the root `package.json`.

### Consequences

- Good: one language and toolchain across engine, CLI, Action, and Electron.
- Good: pnpm's strict, content-addressed store and workspace protocol suit a
  monorepo; `workspace:*` wires internal dependencies.
- Good: Electron and the Anthropic SDK are first-class in the TS/Node ecosystem.
- Bad: ties the project to the Node release cadence; LTS bumps are periodic work.
