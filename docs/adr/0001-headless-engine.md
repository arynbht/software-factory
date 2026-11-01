# 1. Headless engine; CLI, Action, skill, and Electron are thin clients

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

The factory must run in four places: a terminal (CLI), CI (GitHub Action), an
agent (Claude Code skill), and a desktop app (Electron). If logic lives in any
one surface, the others drift or cannot enforce the same gates. Where should the
audit/fix/gate logic live?

## Considered Options

- **Headless engine package; every surface is a thin client over it.**
- Logic in the CLI, with the Action shelling out to the CLI and the app
  re-implementing what it needs.
- Logic in the Electron app, with a separate "CI mode".

## Decision Outcome

Chosen: **a headless `@arynbht/factory-engine` package** that resolves profiles,
runs detectors, evaluates gates, and runs generators with no I/O assumptions
beyond a repo path and tokens. The CLI, Action, skill, and desktop shell contain
only argument parsing, presentation, and surface-specific glue.

### Consequences

- Good: CI can enforce the exact gates a developer sees locally.
- Good: the Electron shell is optional; nothing depends on it.
- Good: one place to unit-test detectors and generators.
- Bad: requires discipline to keep presentation out of the engine.
