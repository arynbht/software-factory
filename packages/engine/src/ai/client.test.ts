import { afterEach, describe, expect, it } from "vitest";

import {
  AiError,
  AiKeyError,
  type AiTransport,
  createAiClient,
  resolveAnthropicKey,
} from "./client.js";

const okResult = {
  text: "hello",
  usage: { inputTokens: 10, outputTokens: 5 },
  model: "claude-sonnet-4-6",
};

describe("resolveAnthropicKey", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("prefers the explicit key, then the env var, else undefined", () => {
    expect(resolveAnthropicKey("sk-explicit")).toBe("sk-explicit");
    process.env.ANTHROPIC_API_KEY = "sk-env";
    expect(resolveAnthropicKey()).toBe("sk-env");
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveAnthropicKey()).toBeUndefined();
    expect(resolveAnthropicKey("  ")).toBeUndefined();
  });
});

describe("createAiClient", () => {
  it("passes the request through and returns the transport's result", async () => {
    let seen: unknown;
    const transport: AiTransport = {
      create: async (req) => {
        seen = req;
        return okResult;
      },
    };
    const client = createAiClient({ transport, model: "claude-sonnet-4-6" });
    const out = await client.complete({ prompt: "hi", system: "be terse" });

    expect(out).toEqual(okResult);
    expect(seen).toMatchObject({
      model: "claude-sonnet-4-6",
      system: "be terse",
      prompt: "hi",
      maxTokens: 4096,
    });
  });

  it("retries a retryable error then succeeds", async () => {
    let calls = 0;
    const transport: AiTransport = {
      create: async () => {
        calls++;
        if (calls < 3) throw new AiError("rate limited", true);
        return okResult;
      },
    };
    const client = createAiClient({ transport, maxRetries: 3, backoffMs: 1 });
    const out = await client.complete({ prompt: "hi" });
    expect(out).toEqual(okResult);
    expect(calls).toBe(3);
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    const transport: AiTransport = {
      create: async () => {
        calls++;
        throw new AiError("bad request", false);
      },
    };
    const client = createAiClient({ transport, maxRetries: 3, backoffMs: 1 });
    await expect(client.complete({ prompt: "hi" })).rejects.toBeInstanceOf(
      AiError,
    );
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries on a persistent retryable error", async () => {
    let calls = 0;
    const transport: AiTransport = {
      create: async () => {
        calls++;
        throw new AiError("still down", true);
      },
    };
    const client = createAiClient({ transport, maxRetries: 2, backoffMs: 1 });
    await expect(client.complete({ prompt: "hi" })).rejects.toThrow();
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("times out a hanging request (as a retryable error)", async () => {
    const transport: AiTransport = {
      create: () => new Promise(() => undefined), // never resolves
    };
    const client = createAiClient({
      transport,
      timeoutMs: 20,
      maxRetries: 0,
    });
    await expect(client.complete({ prompt: "hi" })).rejects.toThrow(
      /timed out/,
    );
  });

  it("aborts the in-flight request when the timeout fires (no double-billing)", async () => {
    let seenSignal: AbortSignal | undefined;
    const transport: AiTransport = {
      // Hang until aborted, then settle so the test doesn't leak a timer.
      create: (_req, signal) =>
        new Promise((_, reject) => {
          seenSignal = signal;
          signal?.addEventListener("abort", () =>
            reject(new AiError("aborted", true)),
          );
        }),
    };
    const client = createAiClient({ transport, timeoutMs: 20, maxRetries: 0 });
    await expect(client.complete({ prompt: "hi" })).rejects.toThrow(
      /timed out/,
    );
    // The signal the transport received must be aborted after the timeout, so a
    // retry doesn't run alongside a still-live server-side call.
    expect(seenSignal?.aborted).toBe(true);
  });

  it("throws AiKeyError on the API path when no key is available", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // preferApiKey forces the SDK transport (otherwise the default prefers the
      // Claude CLI when installed); with no key the SDK raises AiKeyError.
      const client = createAiClient({ preferApiKey: true, maxRetries: 0 });
      await expect(client.complete({ prompt: "hi" })).rejects.toBeInstanceOf(
        AiKeyError,
      );
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
