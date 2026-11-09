import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import { detectStacks, templateStacks } from "../stack.js";
import { runTool, splitArgs, ToolNotFoundError } from "./exec.js";
import { deepEqual, getByPath } from "./path.js";
import type { DetectorResult } from "./types.js";

type CommandConfig = Extract<DetectorConfig, { type: "command" }>;

const pass = (message: string): DetectorResult => ({ status: "pass", message });
const fail = (message: string, remediation?: string): DetectorResult => ({
  status: "fail",
  message,
  remediation,
});
const skip = (message: string): DetectorResult => ({ status: "skip", message });

/** A hung tool must not hang the audit: give up and report `skip`. */
const DEFAULT_TIMEOUT_S = 60;

/**
 * Run a tool in the repo root. With `jsonPath`, parse stdout as JSON and check
 * the path (optionally against `equals`); otherwise compare the exit code to
 * `expectExitCode` (default 0). A missing tool or a timeout is a skip, not a
 * failure — callers that must fail closed (the judge) treat skip as failure.
 *
 * With `byStack`, the command for every detected stack that has one runs, and
 * all must pass (a repo with a Node frontend and a Python backend is linted
 * twice). Commands only run when the context allows them: running a test suite
 * is the judge's job (or `audit --commands`), not every routine audit's.
 */
export async function command(
  ctx: AuditContext,
  config: CommandConfig,
): Promise<DetectorResult> {
  if (!ctx.runCommands) {
    return skip(
      "command checks run in the judge (`factory judge`) or with `factory audit --commands`",
    );
  }

  const lines: string[] = [];
  if (config.byStack) {
    const byStack = config.byStack;
    for (const stack of templateStacks(await detectStacks(ctx))) {
      const line = byStack[stack];
      if (line) lines.push(line);
    }
    if (lines.length === 0 && config.run) lines.push(config.run);
    if (lines.length === 0) {
      return skip("no command defined for this repo's stack");
    }
  } else if (config.run) {
    lines.push(config.run);
  }

  const results: DetectorResult[] = [];
  for (const line of lines) {
    const result = await runOne(ctx, config, line);
    if (result.status !== "pass") return result;
    results.push(result);
  }
  return pass(results.map((r) => r.message).join("; "));
}

async function runOne(
  ctx: AuditContext,
  config: CommandConfig,
  line: string,
): Promise<DetectorResult> {
  const [binary, ...args] = splitArgs(line);
  if (!binary) return skip("empty command");

  let result;
  try {
    result = await runTool(binary, args, ctx.repoPath, {
      timeoutMs: (config.timeout ?? DEFAULT_TIMEOUT_S) * 1000,
    });
  } catch (err) {
    if (err instanceof ToolNotFoundError) {
      return skip(`"${binary}" is not installed; skipping`);
    }
    return skip(`could not run "${line}": ${(err as Error).message}`);
  }

  if (config.jsonPath !== undefined) {
    let data: unknown;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      return skip(`"${binary}" output was not valid JSON`);
    }
    const { found, value } = getByPath(data, config.jsonPath);
    if (config.equals !== undefined) {
      return found && deepEqual(value, config.equals)
        ? pass(`${config.jsonPath} == ${JSON.stringify(config.equals)}`)
        : fail(
            `${config.jsonPath} is ${found ? JSON.stringify(value) : "missing"}`,
          );
    }
    return found
      ? pass(`${config.jsonPath} present in output`)
      : fail(`${config.jsonPath} missing from output`);
  }

  const expected = config.expectExitCode ?? 0;
  if (result.exitCode === expected) {
    return pass(`\`${line}\` exited ${result.exitCode}`);
  }
  const tail = `${result.stdout}\n${result.stderr}`
    .trim()
    .split("\n")
    .slice(-8)
    .join("\n");
  return fail(
    `\`${line}\` exited ${result.exitCode} (expected ${expected})${tail ? `\n${tail}` : ""}`,
  );
}
