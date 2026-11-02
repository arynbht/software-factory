import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  bundledPromptsDir,
  loadBundledCatalog,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  type AiClient,
  AiKeyError,
  appendUsage,
  applyChanges,
  buildContext,
  estimateCost,
  evaluateControls,
  EvidenceError,
  type FixPrOptions,
  FixPrError,
  generateArtifact,
  loadUsage,
  openFixPr,
  type PromptError,
  ProfileError,
  resolveToken,
  summarizeUsage,
  WaiverError,
} from "@arynbht/factory-engine";

import { renderFixPlan } from "../report.js";

export interface AiFlags {
  write?: boolean;
  pr?: boolean;
  token?: string;
  color?: boolean;
}

export interface RunAiOptions {
  now?: Date | undefined;
  today?: string | undefined;
  /** GitHub token for --pr (or null to force offline in tests). */
  token?: string | null | undefined;
  /** Inject the AI client (tests). Omit to use the context's SDK-backed client. */
  client?: AiClient | undefined;
  /** Override the PR-opening step (tests). */
  openPr?: FixPrOptions["openPr"] | undefined;
}

async function availableTasks(): Promise<string[]> {
  try {
    return (await readdir(bundledPromptsDir()))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/** `factory ai <task>` — draft an artifact with Claude, as a dry-run/write/PR. */
export async function runAi(
  task: string,
  path: string,
  flags: AiFlags,
  options: RunAiOptions = {},
): Promise<number> {
  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) {
      console.error(`factory ai: not a directory: ${path}`);
      return 1;
    }
  } catch {
    console.error(`factory ai: path not found: ${path}`);
    return 1;
  }

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)):`);
    for (const err of errors) console.error(`  ${err.file}: ${err.message}`);
    return 1;
  }

  const ghToken =
    options.token === null
      ? undefined
      : (options.token ?? resolveToken(flags.token));
  const ctx = buildContext(root, { token: ghToken, now: options.now });
  const client = options.client ?? ctx.ai();

  let profile;
  let waivers;
  try {
    profile = await ctx.profile();
    waivers = await ctx.waivers();
  } catch (err) {
    if (
      err instanceof ProfileError ||
      err instanceof WaiverError ||
      err instanceof EvidenceError
    ) {
      console.error(`factory ai: ${err.message}`);
      return 1;
    }
    throw err;
  }

  // The gap report gives the model current context (essential for explain-gaps).
  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const selected = controls.filter(
    (c) => SEVERITIES.indexOf(c.severity) <= floorRank,
  );
  const results = await evaluateControls(selected, ctx, {
    now: options.now,
    profile,
    waivers,
  });

  // A control whose claude fix is this task (rationale + references for context).
  const control =
    controls.find((c) => c.fix?.type === "claude" && c.fix.task === task) ??
    null;

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const color = flags.color !== false && process.stdout.isTTY === true;

  let result;
  try {
    result = await generateArtifact(ctx, task, {
      client,
      date: today,
      control,
      results,
    });
  } catch (err) {
    if (err instanceof AiKeyError) {
      console.error(
        "factory ai: no Anthropic API key. Set ANTHROPIC_API_KEY and retry.",
      );
      return 1;
    }
    if (isPromptError(err)) {
      const tasks = await availableTasks();
      console.error(
        `factory ai: unknown task "${task}". Available: ${tasks.join(", ")}.`,
      );
      return 1;
    }
    throw err;
  }

  // Record the call so `factory ai usage` can report the running cost.
  const costUsd = estimateCost(result.model, result.usage);
  await appendUsage(root, {
    date: today,
    task,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd,
  }).catch(() => undefined); // logging must never fail the command

  const costLabel = costUsd > 0 ? ` · ~$${costUsd.toFixed(4)}` : "";
  const usageLine = `\nModel ${result.model} · ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens${costLabel} · files consulted: ${
    result.includedFiles.length > 0 ? result.includedFiles.join(", ") : "none"
  }${result.truncated ? " (context truncated to fit)" : ""}`;

  if (flags.pr) {
    try {
      const prOptions: FixPrOptions = { gate: `ai-${task}`, date: today };
      if (options.openPr) prOptions.openPr = options.openPr;
      const pr = await openFixPr(ctx, [result.change], prOptions);
      process.stdout.write(`${renderFixPlan(pr.changeResults, true, color)}\n`);
      if (pr.pr) {
        const verb = pr.pr.reused ? "Updated" : "Opened";
        process.stdout.write(`\n${verb} PR #${pr.pr.number}: ${pr.pr.url}\n`);
      } else {
        process.stdout.write(
          "\nNo changes to propose — no pull request opened.\n",
        );
      }
      process.stdout.write(`${usageLine}\n`);
      return 0;
    } catch (err) {
      if (err instanceof FixPrError) {
        console.error(`factory ai --pr: ${err.message}`);
        return 1;
      }
      throw err;
    }
  }

  const changeResults = await applyChanges(root, [result.change], {
    mode: flags.write ? "write" : "dry-run",
  });
  process.stdout.write(
    `${renderFixPlan(changeResults, Boolean(flags.write), color)}\n`,
  );
  process.stdout.write(`${usageLine}\n`);
  return 0;
}

function isPromptError(err: unknown): err is PromptError {
  return err instanceof Error && err.name === "PromptError";
}

/** `factory ai usage` — summarize `.factory/ai-usage.log`. */
export async function runAiUsage(path: string): Promise<number> {
  const root = resolve(path);
  const entries = await loadUsage(root);
  if (entries.length === 0) {
    process.stdout.write("No AI usage recorded yet.\n");
    return 0;
  }
  const s = summarizeUsage(entries);
  const lines = [
    `AI usage — ${s.calls} call${s.calls === 1 ? "" : "s"}, ${s.inputTokens} in / ${s.outputTokens} out tokens, ~$${s.costUsd.toFixed(4)} total`,
    "",
    "By task:",
    ...Object.entries(s.byTask)
      .sort((a, b) => b[1].costUsd - a[1].costUsd)
      .map(
        ([task, t]) =>
          `  ${task}: ${t.calls} call(s), ~$${t.costUsd.toFixed(4)}`,
      ),
    "",
    "By day:",
    ...Object.entries(s.byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([day, d]) => `  ${day}: ${d.calls} call(s), ~$${d.costUsd.toFixed(4)}`,
      ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
