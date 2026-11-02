# 8. Merge policy: never clobber a human's file; suggest when ambiguous

- Status: accepted
- Date: 2026-11-02
- Deciders: Aryan Bhatia

## Context and Problem Statement

Generators produce files the factory owns (scaffold files) and edits to files a
human also owns (a CI step added to `ci.yml`, a script added to `package.json`).
Re-running `factory fix` must be safe and idempotent: it must never overwrite work
a human did, must not fabricate a structured file from a fragment, and must leave a
clear trail when it cannot apply a change cleanly. How should a planned change
reach disk?

## Considered Options

- **Classify each change as `create` or `merge`, track a managed-file hash
  registry, and divert an ambiguous merge to `<file>.factory-suggested`.**
- Always overwrite the target with the generated content.
- Only ever emit a diff and let the human apply it.

## Decision Outcome

Chosen: a two-mode policy enforced in `applyChanges` (`packages/engine/src/generators/apply.ts`).

- **`create`** writes a whole file the factory owns. It writes only when the target
  is absent, or is factory-managed and unchanged since we wrote it. An existing
  file the factory did not write is reported as a `skip`, never clobbered.
- **`merge`** carries the already-merged contents (a structural YAML/JSON path
  insertion, never a textual overwrite), so writing them is the minimal change. A
  merge never fabricates an absent target — merging into a missing `package.json`
  is a no-op, because building a structured file from one fragment is a
  `template`'s job.
- **Managed-hash registry.** `.factory/state.json` records a hash per generated
  file. That lets a later run tell "unchanged since we wrote it" from "a human
  edited it". When a `merge` targets a managed file a human has since edited,
  re-serialising would destroy their edits — the ambiguous case — so the merged
  result is written alongside as `<file>.factory-suggested` and the human's file is
  left untouched.
- **Path containment.** Every change resolves through a guard that rejects a path
  escaping the repo (`..`/absolute) or passing through a symlink, so a generator
  can only write under the target repo (ADR-0004).
- **Dry run by default.** Nothing is written unless `--write`/`--pr` is passed; a
  dry run still reports the action each change would take.

### Consequences

- Good: re-running `fix` is idempotent and never destroys human edits.
- Good: an ambiguous merge is visible (a `.factory-suggested` file) rather than
  silent data loss or a surprise overwrite.
- Good: the hash registry makes "who last wrote this" auditable.
- Bad: the registry is state the factory must keep correct across renames/moves;
  a file moved outside the factory's knowledge looks human-authored (which fails
  safe — it is skipped).
