// A WRITE-capable Claude Code agent for the build pipeline — the counterpart to the
// read-only audit agent (floorplan/agent.ts). It runs headless inside an isolated
// git worktree (`cwd = worktree`) with `--permission-mode acceptEdits` so it can
// edit files and run the repo's build/test commands without prompting. Its tools
// are file tools, the package managers and node, and read-only git. Running code it
// wrote is inherent to building, so the envelope is what that code can reach: the
// worktree, and an allowlisted environment that holds none of the caller's tokens.
// Combined with PR review, that's the safety envelope for letting an agent write code.
//
// The runner is injectable so the build pipeline is unit-tested without spawning
// `claude` or touching a real worktree.
import { spawn } from "node:child_process";

import { claudeCommand, parseClaudeJson } from "../ai/claude-cli.js";
import { DEFAULT_MODEL } from "../ai/client.js";
import { allowlistedEnv } from "../detectors/exec.js";

/**
 * Scoped tool allow-list: file edits, build/test commands, and git only to look
 * (a bare `git:*` lets `git -C . push` or an alias past any deny rule).
 */
export const BUILD_TOOLS = [
  "Edit",
  "Write",
  "Read",
  "Grep",
  "Glob",
  "Bash(pnpm:*)",
  "Bash(npm:*)",
  "Bash(node:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
] as const;

/** The factory never honours the target repo's .claude config (FACTORY_V2 §12). */
export const ISOLATED_AGENT_ARGS = [
  "--safe-mode",
  "--strict-mcp-config",
  "--no-session-persistence",
] as const;

/**
 * A write-agent's environment: the allowlist (the repo code it runs never sees
 * the caller's tokens) plus what `claude` itself needs to sign in, and `extra`.
 */
export function agentEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...allowlistedEnv(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
    ...extra,
  };
}

/**
 * Carved out of BUILD_TOOLS (deny wins over allow): inline code and ad-hoc
 * package execution (FACTORY_V2 §7.2), pushing (the pipeline pushes, after
 * verify), and the factory's own state, which the agent never edits.
 */
export const DENIED_BUILD_TOOLS = [
  "Bash(node -e:*)",
  "Bash(node --eval:*)",
  "Bash(node -p:*)",
  "Bash(node --print:*)",
  "Bash(npm exec:*)",
  "Bash(npm x:*)",
  "Bash(pnpm exec:*)",
  "Bash(pnpm dlx:*)",
  "Bash(git push:*)",
  "Edit(.factory/**)",
  "Write(.factory/**)",
] as const;

export interface WriteAgentSpec {
  /** The task/instruction fed on stdin. */
  prompt: string;
  /** Appended to Claude Code's system prompt (role + constraints). */
  system: string;
  /** The worktree the agent edits (its working directory). */
  cwd: string;
  model?: string;
  signal?: AbortSignal;
}

/** Runs one write-agent and resolves its raw stdout (`--output-format json`). */
export type WriteAgentRunner = (spec: WriteAgentSpec) => Promise<string>;

const defaultRunner: WriteAgentRunner = async ({
  prompt,
  system,
  cwd,
  model,
  signal,
}) => {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model ?? DEFAULT_MODEL,
    ...ISOLATED_AGENT_ARGS,
    "--permission-mode",
    "acceptEdits",
    "--append-system-prompt",
    system,
    "--allowedTools",
    BUILD_TOOLS.join(","),
    "--disallowedTools",
    DENIED_BUILD_TOOLS.join(","),
  ];
  const { command, argv } = await claudeCommand(args);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd,
      env: agentEnv(),
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
    child.stdin.end(prompt);
  });
};

/** Run the write-agent and return its final text summary. */
export async function runWriteAgent(
  spec: WriteAgentSpec,
  runner: WriteAgentRunner = defaultRunner,
): Promise<{ text: string }> {
  const stdout = await runner(spec);
  const { text } = parseClaudeJson(stdout, spec.model ?? DEFAULT_MODEL);
  return { text };
}
