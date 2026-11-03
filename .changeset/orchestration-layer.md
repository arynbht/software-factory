---
"@arynbht/factory-engine": minor
"@arynbht/factory-desktop": minor
---

Add the orchestration layer — a feature/fix request becomes a gated PR.

A new **Build** tab turns a natural-language request into working code: a read-only,
floor-plan-grounded planner drafts a plan you approve, then a write-capable Claude
agent implements it in an **isolated git worktree** (your working tree is never
touched), self-checks against the repo's tests/lint/typecheck **and** the factory
phase gate with a bounded fix-loop, and — only when the checks pass — commits,
pushes, and opens a reviewable PR. Two human checkpoints (approve the plan, review
the PR) keep it honest. The engine orchestrator (`orchestrate/`) is fully
injectable and unit-tested with no `claude`/git/network.
