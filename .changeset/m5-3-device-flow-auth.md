---
---

M5.3 — GitHub **device-flow sign-in** in the desktop shell (ADR-0007). The main
process runs the device flow (testable, injectable fetch), stores the token with
Electron `safeStorage` (OS keychain) — never in the repo, never across IPC — and
sign-out clears it. The signed-in token flows into the audit adapter so
`github-api` detectors run. The renderer gains sign-in controls (device code +
status + sign-out) over a push channel. The client id is configured via
`FACTORY_GITHUB_CLIENT_ID`; without it, sign-in reports a clear "not configured"
message. No published-package change (private app only).
