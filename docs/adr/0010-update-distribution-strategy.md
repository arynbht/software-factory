# 10. Update and distribution strategy for a private-repo tool

- Status: accepted
- Date: 2026-11-02
- Deciders: Aryan Bhatia

## Context and Problem Statement

The factory ships two things: the `@arynbht/factory` packages (engine, CLI,
action) and the Electron desktop shell (M5). The factory repo is private, which
breaks the usual distribution paths — `electron-updater` cannot read releases from
a private repo without a token, and `npx`-from-registry needs auth. How should the
packages publish and the desktop app update?

## Considered Options

- **Changesets-driven publish to GitHub Packages; a manual in-app "check for
  updates" that calls the Releases API with the user's token.**
- Make the repo public to use the standard auto-updater and npm.
- A self-hosted update server / S3 feed.

## Decision Outcome

Chosen:

- **Packages.** Changesets owns versioning and changelogs. A changeset per PR
  declares the user-facing change and bump type; merging to `main` opens/updates a
  "Version packages" PR; merging that tags and publishes `@arynbht/factory` to
  GitHub Packages and moves the `v1` tag. Consumers in the org `uses:` the action
  by major tag.
- **Desktop updates.** Because `electron-updater` can't read a private repo's
  releases without a token, v1 ships a **manual update check**: the app calls the
  Releases API with the user's existing device-flow token (ADR-0007) and links to
  the installer, rather than silently auto-updating. Revisit auto-update if the
  repo goes public.
- **Supply-chain integrity.** Release artifacts are built in CI with SHA-pinned
  actions, an SBOM, and provenance attestation; the factory audits its own
  workflows against `ci.actions-pinned-sha`, so the distribution pipeline is held
  to the same catalog it enforces on others.

### Consequences

- Good: works today with the repo private; one token model (device flow) covers
  API reads, package auth, and the update check.
- Good: keeping the pipeline SHA-pinned + attested means the tool's own releases
  pass its security lane.
- Bad: no silent auto-update on desktop — the user clicks "check for updates" and
  downloads manually until/unless the repo goes public.
- Bad: GitHub Packages auth is a documented onboarding step for a new teammate;
  the fallback is `npx` from a git URL.
