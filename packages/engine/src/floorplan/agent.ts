// A read-only, repo-scoped Claude Code agent for the deep-audit swarm. Unlike the
// AI transport in ../ai/claude-cli.ts (one prompt → one completion, no file
// access), each agent here runs headless *inside the repo* (`cwd: repoPath`) with
// Claude Code's own Read/Grep/Glob tools so it can actually explore the code — but
// with an allow-list that excludes every edit tool, so the swarm can never mutate
// the repository it is auditing. Auth is the developer's Claude subscription
// (`claude login`); no API key is involved.
//
// The subprocess runner is injectable so the swarm's map/reduce logic is
// unit-tested without spawning anything (mirrors ClaudeRunner in ../ai/claude-cli).
import { spawn } from "node:child_process";

import { claudeCommand, parseClaudeJson } from "../ai/claude-cli.js";
import { DEFAULT_MODEL } from "../ai/client.js";
import { agentEnv, ISOLATED_AGENT_ARGS } from "../orchestrate/write-agent.js";

/** Read-only tool allow-list handed to every swarm agent. No edit tools. */
export const READ_ONLY_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git log:*)",
  "Bash(git ls-files:*)",
] as const;

/** One agent invocation: an instruction, a system prompt, and where to run it. */
export interface AgentSpec {
  /** The task/instruction fed on stdin. */
  prompt: string;
  /** Appended to Claude Code's system prompt (role + output contract). */
  system: string;
  /** The repo the agent explores (its working directory). */
  cwd: string;
  model?: string;
  signal?: AbortSignal;
}

/** Runs one agent and resolves its raw stdout (Claude's `--output-format json`). */
export type AgentRunner = (spec: AgentSpec) => Promise<string>;

/** Spawns the real `claude` CLI, read-only, in the repo. */
const defaultRunner: AgentRunner = async ({
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
    // Never the target repo's .claude config: its hooks would run in here.
    ...ISOLATED_AGENT_ARGS,
    "--append-system-prompt",
    system,
    "--allowedTools",
    READ_ONLY_TOOLS.join(","),
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

/**
 * Pull a JSON object out of an agent's final message. Agents are told to reply
 * with only a JSON object, but models sometimes wrap it in a ```json fence or add
 * a sentence — so we strip a fence and fall back to the outermost `{…}` span.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("agent did not return a JSON object");
  }
}

/**
 * Run one agent and parse its JSON reply. The runner is injectable; the default
 * spawns the real CLI. Returns the parsed payload (shape is the caller's
 * contract — the swarm validates/normalizes it).
 */
export async function runAgent(
  spec: AgentSpec,
  runner: AgentRunner = defaultRunner,
): Promise<unknown> {
  const stdout = await runner(spec);
  const { text } = parseClaudeJson(stdout, spec.model ?? DEFAULT_MODEL);
  return extractJson(text);
}
