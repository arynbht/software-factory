import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { runTool } from "@arynbht/factory-engine";
import { BEATS, listTasks, nextStep } from "@arynbht/factory-runtime";

// Claude Code hooks that `factory init` installs in `.claude/settings.json`
// (§10). They run in the person's interactive session, not the sector agent's
// (which runs with no repo hooks at all).

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false);

async function git(args: string[], cwd: string): Promise<string | null> {
  const res = await runTool("git", args, cwd).catch(() => null);
  return res && res.exitCode === 0 ? res.stdout.trim() : null;
}

/** The PreToolUse input fields the guard reads. */
export interface HookInput {
  cwd?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
}

/**
 * Why an edit must not happen, or null when it may: anything under
 * `.factory/**` (the runtime's state), and anything in the primary checkout
 * while it's on the default branch (work happens in a task's worktree).
 * Only in repos with a factory profile.
 */
export async function guardReason(input: HookInput): Promise<string | null> {
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!target) return null;
  const abs = isAbsolute(target)
    ? target
    : resolve(input.cwd ?? process.cwd(), target);
  // The file may be new: ask git about the nearest directory that exists.
  let dir = dirname(abs);
  while (!(await exists(dir))) {
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  const top = await git(["rev-parse", "--show-toplevel"], dir);
  if (!top || !(await exists(join(top, ".factory", "profile.yml"))))
    return null;

  // git reports the physical path; canonicalise the file's side the same way,
  // or a symlinked checkout (macOS /var → /private/var) slips past the check.
  const physical = join(await realpath(dir), relative(dir, abs));
  const rel = relative(await realpath(top), physical)
    .split(sep)
    .join("/");
  if (rel === ".factory" || rel.startsWith(".factory/"))
    return `${rel} is the factory's state: the runtime writes it, and a person edits it by hand. Use the factory CLI (\`factory task …\`, \`factory waive\`, \`factory profile set\`) instead.`;

  // A task's worktree is a linked worktree: its git dir isn't the common one.
  const gitDir = await git(["rev-parse", "--absolute-git-dir"], dir);
  const common = await git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    dir,
  );
  if (gitDir && common && resolve(gitDir) !== resolve(common)) return null;

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const originHead = await git(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    dir,
  );
  const defaults = originHead
    ? [originHead.replace(/^refs\/remotes\/origin\//, "")]
    : ["main", "master"];
  if (branch && defaults.includes(branch))
    return `this is the primary checkout on ${branch}. Changes go through a task: start one with /factory (it works in .worktrees/<id> and opens a PR), or switch to a branch for a change you're making by hand.`;
  return null;
}

/** `factory hook guard`: a PreToolUse hook; exit 2 blocks the edit and tells Claude why. */
export async function runHookGuard(): Promise<number> {
  let input: HookInput = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
  } catch {
    return 0; // not a hook payload: nothing to guard
  }
  const reason = await guardReason(input);
  if (!reason) return 0;
  process.stderr.write(`factory: ${reason}\n`);
  return 2;
}

/** What a session in this repo starts with: the contract in brief, and open tasks. */
export async function sessionStartText(root: string): Promise<string> {
  const lines = [
    "This repo runs on the factory (see AGENTS.md).",
    "Start every task with /factory. The work happens in .worktrees/<id>, never in this checkout on the default branch.",
    `Beats: sync → ${BEATS.join(" → ")}. A person confirms the card, approves the route, answers stop-and-ask questions, and merges; the factory never merges.`,
  ];
  const agents = await readFile(join(root, "AGENTS.md"), "utf8").catch(
    () => null,
  );
  if (!agents) lines.push("(AGENTS.md is missing: run `factory init`.)");
  const open = await listTasks(root)
    .then((tasks) => tasks.filter((t) => nextStep(t) !== "done"))
    .catch(() => []);
  if (open.length > 0) {
    lines.push("Open tasks:");
    for (const t of open)
      lines.push(`- ${t.card.id} ${t.card.title}: next ${nextStep(t)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** `factory hook session-start`: printed into the session's context. */
export async function runHookSessionStart(path: string): Promise<number> {
  process.stdout.write(await sessionStartText(resolve(path)));
  return 0;
}
