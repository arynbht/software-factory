---
"@arynbht/factory-registry": minor
"@arynbht/factory": minor
---

Factory v2 step 2: the skill registry. `factory skills init|sync|status|add|update|vendor`
over pinned, content-hashed skills fetched into a user-level cache
(`~/.cache/factory/skills/<sha256>/`, verified on every load, mirror fallback),
scanned before install (gitleaks, fail closed; injection rules including
auto-run hooks; human-reviewed `scan_allow` per rule or per file). Always-scope
skills install to `.agents/skills/` with `.claude/skills/` links, git-ignored;
the lock travels. Ships 24 manifests from the Nov 9 research.
