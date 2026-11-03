---
---

Desktop: correctness and security fixes from the M5 review.

- Device-flow sign-in now cancels an in-flight poll on a repeat sign-in or sign-out
  via an `AbortController`, so a superseded poll can't save a stale token or push a
  late outcome; the poller also honors GitHub's returned `interval` on `slow_down`.
- Apply a CSP in dev too (loosened only for Vite's HMR), rather than running the
  renderer policy-free — the Docs screen renders arbitrary repo Markdown.
- `will-navigate` now matches the exact renderer URL instead of a bare `file://`
  prefix, so no local file can be navigated to in-window.
- Markdown rendering restricts link URIs to `http(s)`/`mailto`/`#anchor` and forces
  `rel="noopener noreferrer"` on every link.
- Preload validates the `profile:load`/`save` responses and `safeParse`s the
  `auth:update` push so a malformed payload surfaces as an error instead of throwing
  in the IPC listener.
- Renderer: `handleRemove` catches errors like `handleAdd`; the Fix/AI panels reset
  per repo (keyed) and the Fix panel clears a stale PR banner before each run.
- Repo-store writes are serialized so concurrent add/remove can't clobber the list;
  the audit scorecard counts every result in its totals.
