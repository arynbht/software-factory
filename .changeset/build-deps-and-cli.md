---
"@arynbht/factory-engine": minor
"@arynbht/factory": minor
---

Make the build loop reliable out of the box, and add a `factory build` CLI.

- **Worktree dependency install**: a fresh build worktree has no `node_modules`, so
  the pipeline now installs dependencies (lockfile-detected package manager) before
  the verify step runs the repo's tests/lint/typecheck — no more spurious failures on
  the first build.
- **`factory build "<description>"`**: the orchestration layer from the terminal.
  Plans the change and prints it; with `--yes` it builds it with a write-agent in an
  isolated worktree, self-checks, and opens a gated PR (`--no-push` stops at a local
  branch). Where Claude Code already lives.
