---
---

Desktop (M5.9): add a Settings screen and a manual update check.

- **Settings** (personal state in `userData`, never the repo): theme (system/light/
  dark, applied live with a light palette added for the non-dark themes), default
  GitHub org, an "prefer the Anthropic API over the Claude CLI" toggle, and an
  Anthropic API key stored encrypted via `safeStorage` (never crossing IPC — the
  renderer only learns whether a key is set). The AI screen now runs with these
  resolved transport options.
- **Update check** (ADR-0010 private-repo path): queries the GitHub Releases API with
  the signed-in token and reports whether a newer release is available, with a link to
  download it — an opt-in launch check surfaces a dismissible banner, and Settings has
  a manual "Check for updates" button.
