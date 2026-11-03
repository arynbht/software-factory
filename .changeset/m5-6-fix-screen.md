---
---

M5.6 — Fix screen in the desktop shell: a dry-run of `factory fix` listing the
proposed changes per control (expand to see before/after), with Apply-locally and
Open-PR actions. A new electron-free fix adapter (planFix/applyFix/
openFixPrForRepo) mirrors the CLI selection and reuses planControls/applyChanges/
openFixPr. No published-package change (private app only).
