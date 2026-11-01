# 2. Controls are YAML data validated by a zod schema

- Status: accepted
- Date: 2026-11-01
- Deciders: Aryan Bhatia

## Context and Problem Statement

The catalog will grow to ~140 controls across 14 disciplines, and more over time.
If each control is code, adding a discipline is an engineering task and the
catalog is hard to review or browse. How should controls be represented?

## Considered Options

- **Controls as YAML files validated by a zod schema**, one file per control.
- Controls as TypeScript objects/classes.
- Controls in a database.

## Decision Outcome

Chosen: **one YAML file per control** under `packages/catalog/controls/<lane>/`,
validated at load time against a zod schema (`schema.ts`), with a JSON Schema
exported from it for editor autocomplete. A `catalog:validate` script fails CI on
a bad control (missing `references`, duplicate id, etc.).

### Consequences

- Good: adding a discipline means adding files, not code.
- Good: the catalog is diffable, reviewable, and renderable to Markdown.
- Good: non-engineers could contribute controls.
- Bad: detectors/generators referenced by controls still need code; the YAML only
  declares intent, not behaviour.
