// A WRITE-capable Claude Code agent for the build pipeline — the counterpart to the
// read-only audit agent (floorplan/agent.ts). It runs headless inside an isolated
// git worktree (`cwd = worktree`) with `--permission-mode acceptEdits` so it can
// edit files and run the repo's build/test commands without prompting, but its tool
// allow-list is scoped: file tools plus only pnpm/npm/node/git Bash — never
// arbitrary shell. Combined with worktree isolation and PR review, that's the safety
// envelope for letting an agent write code.
//
// The runner is injectable so the build pipeline is unit-tested without spawning
// `claude` or touching a real worktree.
import { spawn } from "node:child_process";

import { claudeCommand, parseClaudeJson } from "../ai/claude-cli.js";
import { DEFAULT_MODEL } from "../ai/client.js";

/** Scoped tool allow-list: file edits + build/test/git Bash only. */
export const BUILD_TOOLS = [
  "Edit",
  "Write",
  "Read",
  "Grep",
  "Glob",
  "Bash(pnpm:*)",
  "Bash(npm:*)",
  "Bash(node:*)",
  "Bash(git:*)",
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
    "--permission-mode",
    "acceptEdits",
    "--append-system-prompt",
    system,
    "--allowedTools",
    BUILD_TOOLS.join(","),
  ];
  const { command, argv } = await claudeCommand(args);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd,
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
