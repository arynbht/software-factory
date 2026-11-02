---
"@arynbht/factory-engine": minor
---

Add the Anthropic SDK wrapper (`ai/client.ts`): `createAiClient().complete()` over
the Messages API with `resolveAnthropicKey`, model pinning (configurable default),
and client-layer retry-with-backoff + timeout so transient 429/5xx/timeouts are
handled deterministically. The real SDK is loaded lazily (only on an actual call)
and the transport is injectable, so non-AI paths stay light and tests never hit the
network. The key is read from `ANTHROPIC_API_KEY` and never stored or logged.
