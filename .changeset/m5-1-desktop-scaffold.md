---
---

M5.1 — scaffold the Electron desktop shell (`apps/desktop`) with electron-vite
(main/preload/renderer), Tailwind, and a security baseline: `contextIsolation`,
`sandbox`, `nodeIntegration: false`, a dev/prod Content-Security-Policy, an
allow-listed `shell.openExternal`, and a typed, zod-validated IPC bridge (smoke
`app:ping` round-trip). Wires the monorepo build: `apps/desktop` leaves the root
`tsc --build` graph and carries its own `typecheck` (added to CI), with ESLint
React + main/preload overrides. No published-package change (private app + build
config only).
