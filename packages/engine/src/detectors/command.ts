import type { DetectorConfig } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
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

/**
 * Run a tool in the repo root. With `jsonPath`, parse stdout as JSON and check
 * the path (optionally against `equals`); otherwise compare the exit code to
 * `expectExitCode` (default 0). A missing tool is a skip, not a failure.
 */
/** A hung tool must not hang the audit: give up and report `skip`. */
const COMMAND_TIMEOUT_MS = 60_000;

export async function command(
  ctx: AuditContext,
  config: CommandConfig,
): Promise<DetectorResult> {
  const [binary, ...args] = splitArgs(config.run);
  if (!binary) return skip("empty command");

  let result;
  try {
    result = await runTool(binary, args, ctx.repoPath, {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof ToolNotFoundError) {
      return skip(`"${binary}" is not installed; skipping`);
    }
    return skip(`could not run "${config.run}": ${(err as Error).message}`);
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
  return result.exitCode === expected
    ? pass(`exited ${result.exitCode}`)
    : fail(`exited ${result.exitCode} (expected ${expected})`);
}
