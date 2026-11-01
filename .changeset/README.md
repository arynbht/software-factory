# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets).

Add a changeset for every user-facing change:

```bash
pnpm changeset
```

Pick the affected packages and the bump type (patch / minor / major), and write a
one-line description. Merging to `main` opens or updates a "Version packages" PR
that applies the bumps and updates changelogs.
