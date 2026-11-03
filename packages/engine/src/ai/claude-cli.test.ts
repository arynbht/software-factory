import { describe, expect, it, vi } from "vitest";

import { AiError } from "./client.js";
import { claudeCliTransport, parseClaudeJson } from "./claude-cli.js";

describe("parseClaudeJson", () => {
  it("extracts text, usage, and model from the CLI result JSON", () => {
    const out = JSON.stringify({
      type: "result",
      result: "the drafted artifact",
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 120, output_tokens: 45 },
    });
    const result = parseClaudeJson(out, "fallback");
    expect(result.text).toBe("the drafted artifact");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("throws on an error result", () => {
    const out = JSON.stringify({ is_error: true, result: "rate limited" });
    expect(() => parseClaudeJson(out, "m")).toThrow(/rate limited/);
  });

  it("throws on non-JSON output", () => {
    expect(() => parseClaudeJson("not json", "m")).toThrow(AiError);
  });
});

describe("claudeCliTransport", () => {
  it("passes the prompt on stdin and the model/system as args", async () => {
    const run = vi.fn(() =>
      Promise.resolve(JSON.stringify({ result: "ok", usage: {}, model: "m" })),
    );
    const transport = claudeCliTransport({ run });
    const result = await transport.create(
      {
        model: "claude-opus-4-8",
        system: "be terse",
        prompt: "draft it",
        maxTokens: 100,
      },
      undefined,
    );

    expect(result.text).toBe("ok");
    const [args, input] = run.mock.calls[0]!;
    expect(input).toBe("draft it");
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-8");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("be terse");
  });

  it("wraps a runner failure as an AiError", async () => {
    const run = vi.fn(() => Promise.reject(new Error("spawn ENOENT")));
    const transport = claudeCliTransport({ run });
    await expect(
      transport.create(
        { model: "m", system: undefined, prompt: "x", maxTokens: 1 },
        undefined,
      ),
    ).rejects.toBeInstanceOf(AiError);
  });
});
