---
"@arynbht/factory-engine": patch
---

Abort the in-flight AI request when its timeout fires. `withTimeout` now creates
an `AbortController` and passes its signal to the Anthropic SDK call, aborting it
in the `finally` branch. Previously a timed-out request kept running server-side
while a retry was billed alongside it, and those extra tokens never reached
`.factory/ai-usage.log`.
