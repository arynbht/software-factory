---
---

M5.8 — Docs screen in the desktop shell: renders the repo's Markdown (docs/,
.factory/, .github/, root *.md) with Mermaid diagrams, via the engine's contained
glob/read (symlink-safe, repo-rooted). Markdown is sanitized with DOMPurify and
Mermaid runs at securityLevel "strict". No published-package change (private app).
