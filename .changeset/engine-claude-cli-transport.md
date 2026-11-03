---
"@arynbht/factory-engine": minor
"@arynbht/factory": patch
---

AI now uses the developer's Claude subscription via the Claude Code CLI by
default, not a metered API key. A new `claudeCliTransport` runs `claude` in
headless mode (`claude -p --output-format json`, subscription auth); the AI
client picks it automatically when the `claude` binary is on PATH and falls back
to the `ANTHROPIC_API_KEY` SDK transport otherwise (`preferApiKey` forces the
API). The `claude` fix generator only auto-drafts when AI is explicitly
configured (`ctx.aiEnabled`: an injected transport or an API key), so a plain
`factory fix`/dry-run never spawns the interactive CLI; deliberate drafting via
`factory ai` uses the subscription.
