// AI adapter: list the Claude-drafted tasks, run one (on the subscription CLI by
// default, API key as fallback), and apply the draft locally or as a PR. The run
// returns the draft without writing it, so the renderer previews exactly what
// apply/PR will persist. Electron-free; only `listAiTasks` is unit-tested (the
// others call the model / git).
import { readdir } from "node:fs/promises";

import { bundledPromptsDir } from "@arynbht/factory-catalog";
import {
  applyChanges,
  buildContext,
  type Change,
  estimateCost,
  generateArtifact,
  loadPrompt,
  openFixPr,
} from "@arynbht/factory-engine";

import type { AiRunResult, AiTaskInfo, FixPrOutcome } from "../../shared/ipc";

/**
 * AI transport options resolved from the user's settings: the stored Anthropic key
 * and whether to force the metered API over the Claude CLI. Omitted fields fall
 * back to the engine defaults (CLI-then-env-API).
 */
export interface AiOptions {
  apiKey?: string | undefined;
  preferApiKey?: boolean | undefined;
}

function aiContextOptions(ai?: AiOptions): {
  apiKey?: string;
  preferApiKey?: boolean;
} {
  return {
    ...(ai?.apiKey ? { apiKey: ai.apiKey } : {}),
    ...(ai?.preferApiKey ? { preferApiKey: true } : {}),
  };
}

export async function listAiTasks(): Promise<AiTaskInfo[]> {
  const dir = bundledPromptsDir();
  const files = await readdir(dir);
  const tasks: AiTaskInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const task = file.slice(0, -3);
    try {
      const prompt = await loadPrompt(task, dir);
      tasks.push({ task, output: prompt.output });
    } catch {
      // skip a malformed prompt rather than failing the whole list
    }
  }
  tasks.sort((a, b) => a.task.localeCompare(b.task));
  return tasks;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runAiTask(
  repoPath: string,
  task: string,
  token?: string,
  ai?: AiOptions,
): Promise<AiRunResult> {
  const ctx = buildContext(repoPath, {
    ...(token ? { token } : {}),
    ai: aiContextOptions(ai),
  });
  const result = await generateArtifact(ctx, task, {
    client: ctx.ai(),
    date: today(),
  });
  return {
    task,
    outputPath: result.outputPath,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: estimateCost(result.model, result.usage),
    includedFiles: result.includedFiles,
    truncated: result.truncated,
    contents: result.change.type === "file" ? result.change.contents : "",
  };
}

function draftChange(
  task: string,
  outputPath: string,
  contents: string,
): Change {
  return {
    type: "file",
    controlId: `ai.${task}`,
    path: outputPath,
    contents,
    op: "create",
  };
}

export async function applyAiDraft(
  repoPath: string,
  task: string,
  outputPath: string,
  contents: string,
): Promise<{ action: string; path: string }> {
  const [result] = await applyChanges(
    repoPath,
    [draftChange(task, outputPath, contents)],
    { mode: "write" },
  );
  return {
    action: result?.action ?? "unchanged",
    path: result?.path ?? outputPath,
  };
}

export async function openAiPr(
  repoPath: string,
  task: string,
  outputPath: string,
  contents: string,
  token?: string,
  ai?: AiOptions,
): Promise<FixPrOutcome> {
  const ctx = buildContext(repoPath, {
    ...(token ? { token } : {}),
    ai: aiContextOptions(ai),
  });
  const result = await openFixPr(
    ctx,
    [draftChange(task, outputPath, contents)],
    { gate: `ai-${task}`, date: today(), titles: { [`ai.${task}`]: task } },
  );
  return {
    pr: result.pr
      ? {
          number: result.pr.number,
          url: result.pr.url,
          reused: result.pr.reused,
        }
      : null,
    commits: result.commits.length,
    pushed: result.pushed,
    changeResults: result.changeResults,
    skippedEffects: result.skippedEffects,
  };
}
