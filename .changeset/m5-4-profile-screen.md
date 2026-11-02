---
"@arynbht/factory-engine": patch
---

M5.4 — Profile screen in the desktop shell, and a new engine `updateProfile` that
writes `.factory/profile.yml` with a **minimal, comment-preserving** edit (only
changed leaves; an absent flag/lane keeps its default, so toggling one flag yields
a one-line diff). The desktop form edits type, phase, severity-floor, stack, risk
flags, and lane toggles — driven by catalog enum lists sent over IPC, so the
renderer never imports the catalog — and saves through `updateProfile`.
