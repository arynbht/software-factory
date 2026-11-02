# 9. Context-packer limits: size cap, task-scoped selection, best-effort secret guards

- Status: accepted
- Date: 2026-11-02
- Deciders: Aryan Bhatia

## Context and Problem Statement

The `claude` generators send repo content to the Messages API to draft artifacts
(threat model, ADRs, runbooks). Sending a repo to a third-party model raises three
risks: cost/latency if the context is unbounded, leaking secrets into the prompt or
the PR description, and a reviewer not knowing what the model actually saw. How
should the context packer bound and sanitise what it sends?

## Considered Options

- **A hard byte cap, task-scoped file globs, layered secret guards, and a
  disclosed file list — all in `packContext`.**
- Send the whole repo and rely on the model to ignore secrets.
- Require the user to hand-pick every file per task.

## Decision Outcome

Chosen: `packContext` (`packages/engine/src/ai/context.ts`) assembles the profile,
the gap report, the control's rationale and references, and a size-capped selection
of repo files chosen by the task's globs.

- **Size cap.** A hard byte budget (default 60 KB ≈ 15k tokens) across included
  file contents. Files are added in a stable (sorted) order until the cap is hit;
  the result reports `truncated` so the caller can note it.
- **Task-scoped selection.** Only files matching the task's globs are candidates
  (for a threat model: architecture docs, route/auth modules, IaC), not the whole
  tree.
- **Layered, best-effort secret guards** (`redact.ts`): a path denylist (`.env`,
  key/cert/credential-store extensions, `.aws/.ssh/.kube/.gnupg/.docker`,
  `kubeconfig`), a binary-file skip (a NUL byte in the first 8 KB), and a content
  scan for common credential shapes (cloud keys, provider tokens, JWTs, DB URLs
  with an inline password, `key=value` secrets). A match omits the file. This is
  explicitly best-effort, not a guarantee — run gitleaks over the candidates when
  stronger assurance is needed.
- **Symlink containment.** The packer reads through `ctx.readFile`, which does not
  follow a symlink out of the repo, and `ctx.glob` does not traverse symlinked
  directories — so a repo can't alias a file to `~/.aws/credentials` and leak it
  (ADR-0008 guards share this).
- **Disclosed file list.** `includedFiles` and `skippedSensitive` are returned and
  written into the PR description, so a reviewer knows exactly what the model saw
  and what was withheld.

### Consequences

- Good: bounded cost; secrets kept out by default; the reviewer has provenance.
- Good: a false "sensitive" only omits a file, which is always safe.
- Bad: the content scan is a curated regex set, not a full scanner — an unusual
  secret shape can still slip through, so the guard is defence-in-depth, not a
  promise. The cap can also drop a large-but-relevant file (reported as truncated).
