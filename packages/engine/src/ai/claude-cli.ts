// A transport that runs the local Claude Code CLI in headless mode instead of the
// metered Messages API — so the factory's AI uses the developer's Claude
// subscription (`claude login`), not an API key. The subprocess runner is
// injectable so the JSON parsing is unit-tested without spawning anything.
import { spawn } from "node:child_process";

import { resolveOnWindows } from "../detectors/exec.js";
import {
  AiError,
  type AiTransport,
  type CompleteResult,
  type TransportRequest,
} from "./client.js";

/** Runs `claude` with args, feeding `input` on stdin; resolves stdout. */
export type ClaudeRunner = (
  args: string[],
  input: string,
  signal?: AbortSignal,
) => Promise<string>;

export interface ClaudeCliOptions {
  model?: string | undefined;
  /** Inject a fake runner in tests; omit to spawn the real `claude` binary. */
  run?: ClaudeRunner | undefined;
}

/** Resolve the `claude` invocation, handling a Windows `.cmd`/`.bat` shim. */
async function claudeCommand(
  args: string[],
): Promise<{ command: string; argv: string[] }> {
  if (process.platform !== "win32") return { command: "claude", argv: args };
  const resolved = await resolveOnWindows("claude");
  if (!resolved) throw new Error("the `claude` CLI was not found on PATH");
  if (/\.(cmd|bat)$/i.test(resolved)) {
    return { command: "cmd.exe", argv: ["/d", "/s", "/c", resolved, ...args] };
  }
  return { command: resolved, argv: args };
}

const defaultRunner: ClaudeRunner = async (args, input, signal) => {
  const { command, argv } = await claudeCommand(args);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, argv, {
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });
    child.stdin.end(input);
  });
};

/** Parse Claude Code's `--output-format json` result into a CompleteResult. */
export function parseClaudeJson(
  stdout: string,
  fallbackModel: string,
): CompleteResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new AiError("the claude CLI returned non-JSON output", false);
  }
  if (data.is_error === true) {
    throw new AiError(
      typeof data.result === "string"
        ? data.result
        : "the claude CLI reported an error",
      false,
    );
  }
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  return {
    text: typeof data.result === "string" ? data.result : "",
    usage: {
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
    },
    model: typeof data.model === "string" ? data.model : fallbackModel,
  };
}

/** Build a transport backed by the local `claude` CLI (subscription auth). */
export function claudeCliTransport(
  options: ClaudeCliOptions = {},
): AiTransport {
  const run = options.run ?? defaultRunner;
  return {
    async create(req: TransportRequest, signal) {
      const args = ["-p", "--output-format", "json", "--model", req.model];
      if (req.system) args.push("--append-system-prompt", req.system);
      let stdout: string;
      try {
        stdout = await run(args, req.prompt, signal);
      } catch (err) {
        throw new AiError(
          `claude CLI failed: ${(err as Error).message}`,
          false,
        );
      }
      return parseClaudeJson(stdout, req.model);
    },
  };
}

/** True when the `claude` CLI is on PATH (so we can use the subscription). */
export async function claudeCliAvailable(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      return (await resolveOnWindows("claude")) !== null;
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn("claude", ["--version"], { windowsHide: true });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
      );
    });
    return true;
  } catch {
    return false;
  }
}
