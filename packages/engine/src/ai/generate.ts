// Run an AI task: load its prompt template, pack secret-guarded context, call the
// model, and render a generated file with the review header + checklist convention.
// Used by the `claude` generator (control-wired tasks) and by `factory ai <task>`.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { bundledPromptsDir, type Control } from "@arynbht/factory-catalog";
import { parse as parseYaml } from "yaml";

import type { AiClient, AiUsage } from "./client.js";
import type { AuditContext } from "../context.js";
import type { ControlResult } from "../evaluate.js";
import type { Change } from "../generators/types.js";
import { packContext } from "./context.js";

export interface PromptTemplate {
  task: string;
  output: string;
  globs: string[];
  control?: string | undefined;
  checklist: string[];
  /** The system prompt (the body after the front-matter). */
  system: string;
}

export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptError";
  }
}

/** Load and parse a task's prompt template from the bundled prompts directory. */
export async function loadPrompt(
  task: string,
  dir = bundledPromptsDir(),
): Promise<PromptTemplate> {
  let raw: string;
  try {
    raw = await readFile(resolve(dir, `${task}.md`), "utf8");
  } catch {
    throw new PromptError(`no prompt template for task "${task}"`);
  }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new PromptError(`prompt "${task}" is missing its front-matter`);
  }
  const fm = (parseYaml(match[1]!) ?? {}) as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof fm[k] !== "string" || fm[k] === "") {
      throw new PromptError(
        `prompt "${task}" front-matter: "${k}" must be a string`,
      );
    }
    return fm[k];
  };
  const strArray = (k: string): string[] => {
    const v = fm[k] ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new PromptError(
        `prompt "${task}" front-matter: "${k}" must be a string list`,
      );
    }
    return v as string[];
  };
  return {
    task: str("task"),
    output: str("output"),
    globs: strArray("globs"),
    ...(typeof fm["control"] === "string" ? { control: fm["control"] } : {}),
    checklist: strArray("checklist"),
    system: match[2]!.trim(),
  };
}

export interface GenerateOptions {
  client: AiClient;
  /** Today's date as YYYY-MM-DD (injected; the engine never reads the clock). */
  date: string;
  control?: Control | null | undefined;
  results?: ControlResult[] | undefined;
  maxTokens?: number | undefined;
  /** Override the prompts directory (tests). */
  promptsDir?: string | undefined;
}

export interface GenerateResult {
  change: Change;
  usage: AiUsage;
  model: string;
  includedFiles: string[];
  truncated: boolean;
  outputPath: string;
}

/** Produce the generated artifact for a task as a `create` file change. */
export async function generateArtifact(
  ctx: AuditContext,
  task: string,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const prompt = await loadPrompt(task, options.promptsDir);

  const packed = await packContext(ctx, {
    task,
    globs: prompt.globs,
    control: options.control,
    results: options.results,
  });

  const completion = await options.client.complete({
    system: prompt.system,
    prompt: packed.text,
    ...(options.maxTokens !== undefined
      ? { maxTokens: options.maxTokens }
      : {}),
  });

  const contents = renderGeneratedFile({
    task,
    date: options.date,
    model: completion.model,
    filesConsulted: packed.includedFiles,
    body: completion.text,
    checklist: prompt.checklist,
  });

  return {
    change: {
      type: "file",
      controlId: options.control?.id ?? `ai.${task}`,
      path: prompt.output,
      contents,
      op: "create",
    },
    usage: completion.usage,
    model: completion.model,
    includedFiles: packed.includedFiles,
    truncated: packed.truncated,
    outputPath: prompt.output,
  };
}

interface RenderArgs {
  task: string;
  date: string;
  model: string;
  filesConsulted: string[];
  body: string;
  checklist: string[];
}

/**
 * Wrap the model's output in the review convention: a provenance header (generated
 * by / date / model / files consulted / empty `reviewed-by:`) and, if the template
 * defines one, a reviewer checklist — both as Markdown comment blocks so they don't
 * render in the document but travel with it ("Claude drafts, humans sign").
 */
export function renderGeneratedFile(args: RenderArgs): string {
  const files = args.filesConsulted.length
    ? args.filesConsulted.join(", ")
    : "(none)";
  const header = [
    "<!-- factory:generated",
    `task: ${args.task}`,
    `generated-by: factory ai ${args.task}`,
    `date: ${args.date}`,
    `model: ${args.model}`,
    `files-consulted: ${files}`,
    "reviewed-by:",
    "-->",
  ].join("\n");

  const parts = [header, "", args.body.trim()];
  if (args.checklist.length > 0) {
    parts.push(
      "",
      [
        "<!-- factory:reviewer-checklist",
        ...args.checklist.map((item) => `- [ ] ${item}`),
        "-->",
      ].join("\n"),
    );
  }
  return `${parts.join("\n")}\n`;
}
