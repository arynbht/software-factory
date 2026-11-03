import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AiTransport, createAiClient } from "./client.js";
import { buildContext } from "../context.js";
import { generateArtifact, loadPrompt, PromptError } from "./generate.js";
import type { GitRunner } from "./git-context.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "factory-gen-"));
  made.push(d);
  return d;
}

// A client that returns a fixed, recorded response — no network.
function recorded(text: string): ReturnType<typeof createAiClient> {
  const transport: AiTransport = {
    create: async () => ({
      text,
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-6",
    }),
  };
  return createAiClient({ transport });
}

describe("loadPrompt", () => {
  it("loads a bundled prompt with its front-matter and system body", async () => {
    const prompt = await loadPrompt("explain-gaps");
    expect(prompt.task).toBe("explain-gaps");
    expect(prompt.output).toBe("docs/factory-gaps.md");
    expect(prompt.checklist.length).toBeGreaterThan(0);
    expect(prompt.system).toContain("senior engineer");
  });

  it("throws for an unknown task", async () => {
    await expect(loadPrompt("no-such-task")).rejects.toBeInstanceOf(
      PromptError,
    );
  });
});

describe("generateArtifact (recorded response)", () => {
  it("renders explain-gaps with the review header + checklist at the output path", async () => {
    const dir = await tmp();
    const ctx = buildContext(dir);
    const result = await generateArtifact(ctx, "explain-gaps", {
      client: recorded("## Security\nYou have no SAST yet.\n"),
      date: "2026-11-01",
      results: [
        {
          controlId: "sec.sast.ci",
          title: "SAST runs in CI",
          status: "fail",
        } as never,
      ],
    });

    expect(result.outputPath).toBe("docs/factory-gaps.md");
    expect(result.change).toMatchObject({
      type: "file",
      path: "docs/factory-gaps.md",
      op: "create",
      controlId: "ai.explain-gaps",
    });
    const body = result.change.type === "file" ? result.change.contents : "";
    expect(body).toContain("<!-- factory:generated");
    expect(body).toContain("date: 2026-11-01");
    expect(body).toContain("model: claude-sonnet-4-6");
    expect(body).toContain("reviewed-by:");
    expect(body).toContain("You have no SAST yet.");
    expect(body).toContain("factory:reviewer-checklist");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it("uses a custom prompts dir and the control id when control-wired", async () => {
    const promptsDir = await tmp();
    await mkdir(promptsDir, { recursive: true });
    await writeFile(
      join(promptsDir, "demo.md"),
      "---\ntask: demo\noutput: docs/demo.md\n---\nWrite a demo.",
    );
    const dir = await tmp();
    const ctx = buildContext(dir);

    const result = await generateArtifact(ctx, "demo", {
      client: recorded("demo output"),
      date: "2026-11-01",
      promptsDir,
      control: { id: "doc.demo" } as never,
    });

    expect(result.change.controlId).toBe("doc.demo");
    const body = result.change.type === "file" ? result.change.contents : "";
    expect(body).toContain("demo output");
    // No checklist in this template → no checklist block.
    expect(body).not.toContain("reviewer-checklist");
  });

  it("gathers git history for the changelog task and feeds it to the prompt", async () => {
    const dir = await tmp();
    const ctx = buildContext(dir);

    // A fake runner — no real repo needed — proving the git context is injected
    // and task-scoped.
    const runner: GitRunner = {
      lastTag: async () => "v1.2.0",
      tags: async () => ["v1.2.0", "v1.1.0"],
      log: async (range) => {
        expect(range).toBe("v1.2.0..HEAD");
        return [
          { hash: "abcdef1234", subject: "feat: add export", body: "" },
          { hash: "0987654321", subject: "fix: crash on open", body: "" },
        ];
      },
    };

    // A client that records the prompt it was handed.
    let seenPrompt = "";
    const transport: AiTransport = {
      create: async (req) => {
        seenPrompt = req.prompt;
        return {
          text: "## [1.3.0]\n### Added\n- Export\n",
          usage: { inputTokens: 10, outputTokens: 5 },
          model: "claude-sonnet-4-6",
        };
      },
    };

    const result = await generateArtifact(ctx, "changelog", {
      client: createAiClient({ transport }),
      date: "2026-11-03",
      gitRunner: runner,
    });

    expect(result.outputPath).toBe("CHANGELOG.md");
    expect(result.change.controlId).toBe("ai.changelog");
    // The git context reached the model.
    expect(seenPrompt).toContain("## Git history");
    expect(seenPrompt).toContain("v1.2.0");
    expect(seenPrompt).toContain("feat: add export");
    expect(seenPrompt).toContain("fix: crash on open");
    expect(seenPrompt).toContain("### Tags");
  });

  it("does not gather git history for a non-changelog task", async () => {
    const dir = await tmp();
    const ctx = buildContext(dir);

    let logCalled = false;
    const runner: GitRunner = {
      lastTag: async () => "v1.0.0",
      tags: async () => ["v1.0.0"],
      log: async () => {
        logCalled = true;
        return [];
      },
    };

    let seenPrompt = "";
    const transport: AiTransport = {
      create: async (req) => {
        seenPrompt = req.prompt;
        return {
          text: "ok",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "claude-sonnet-4-6",
        };
      },
    };

    await generateArtifact(ctx, "explain-gaps", {
      client: createAiClient({ transport }),
      date: "2026-11-03",
      gitRunner: runner,
    });

    expect(logCalled).toBe(false);
    expect(seenPrompt).not.toContain("## Git history");
  });
});
