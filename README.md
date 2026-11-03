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

> Status: 1.0 — first stable release. See
> [`software-factory-build-plan.md`](./software-factory-build-plan.md) for the full
> product definition, milestones, and control catalog, and
> [`docs/catalog/`](./docs/catalog/) for the rendered controls.

## Using the factory

Pick the client that fits — all three run the same engine over the same catalog.

### GitHub Action (audit in CI)

Add a workflow that runs the audit on every pull request and fails the job when the
phase gate is red:

```yaml
# .github/workflows/factory.yml
name: factory
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: arynbht/software-factory@v1
```

`factory init` scaffolds this workflow for you.

### CLI (`factory`)

The `@arynbht/factory` package publishes to GitHub Packages (ADR-0010). After the
one-time registry auth, run it in a repo:

```sh
factory init            # interactive profile + self-audit workflow
factory audit           # scorecard by lane; phase gate verdict
factory fix --pr        # open remediation PRs for the gaps it can fix
factory ai threat-model # draft an artifact for review (20 tasks available)
```

## Desktop app

The desktop shell wraps the engine in a GUI: sign in, add your repos, run audits,
browse the lane scorecard and phase gates, apply fixes, and read the docs.

### Install

Download the installer for your OS from the repo's
[Releases](https://github.com/arynbht/software-factory/releases) page (look for a
`desktop-v*` release):

- **macOS** — `.dmg` (Apple silicon or Intel). The build is unsigned for now, so on
  first launch right-click the app → **Open** and confirm, rather than double-clicking.
- **Windows** — `.exe` installer. SmartScreen may warn on an unsigned build; choose
  **More info → Run anyway**.
- **Linux** — `.AppImage` (mark it executable: `chmod +x *.AppImage`) or the `.deb`.

Each release also ships a CycloneDX SBOM and build-provenance attestations for the
installers.

### First run

1. Click **Sign in with GitHub** and complete the device-flow prompt in your browser
   (enter the shown code at <https://github.com/login/device>). The token is stored
   encrypted in your OS keychain via Electron `safeStorage` — it never leaves your
   machine and never touches the renderer.
2. **Add a repo** with the folder picker, then open it to run an audit and see the
   scorecard. Shared state is written to `.factory/` in the target repo; the app
   keeps only personal preferences (theme, default org, update preference).

### Updates

Because the repo is private, the app does a **manual** update check (ADR-0010):
**Settings → Check for updates** queries the Releases API with your signed-in token
and links you to the newer installer to download. There is no silent auto-update.

## License

[MIT](./LICENSE)
