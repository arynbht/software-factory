---
---

M5.2 — the first real flow in the desktop shell: **Repos → run audit → Scorecard**.
A main-process engine adapter calls the headless engine directly
(`loadBundledCatalog` + severity-floor + `evaluateControls`) and returns a
lane-grouped scorecard over the zod-validated IPC bridge; the renderer adds local
repo folders (persisted in `userData`) and renders the 14-lane scorecard with
expandable controls (rationale + references). Establishes the shadcn/ui
foundation (Tailwind theme, `cn`, Button/Card, `@/` alias). No published-package
change (private app only).
