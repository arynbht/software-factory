# Software Factory

An auditor and scaffolder for GitHub repositories.

Give it a repo and a profile describing what the project is and what risks it
carries, and the factory computes which controls apply, checks which are
satisfied, reports the gaps by phase and discipline, and generates the fixes as
pull requests. It works identically on an empty repo and a half-built one.

- **Controls are data, code is the engine.** Every discipline is a set of YAML
  controls; adding a discipline means adding files, not TypeScript.
- **Headless first.** A TypeScript engine does the work; the CLI, GitHub Action,
  Claude Code skill, and Electron desktop shell are thin clients over it.
- **The repo is the source of truth.** Shared state lives in `.factory/` inside
  the target repo; the app stores only personal preferences.
- **Claude drafts, humans sign.** Every AI-generated artifact lands as a
  reviewable PR and still requires human evidence to pass a gate.

> Status: early development. See
> [`software-factory-build-plan.md`](./software-factory-build-plan.md) for the
> full product definition, milestones, and control catalog.

## License

[MIT](./LICENSE)
