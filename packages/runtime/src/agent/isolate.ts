// The isolate beat (§3.3): a worktree per task, cut from the remote's default
// branch, with its own branch, port and database name, and with git hooks
// switched off inside it. The record (env.json) lives in the task directory of
// the primary checkout, which the agent has no path to.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { simpleGit } from "simple-git";

import { loadTask, type Task, TaskError, TASKS_DIR } from "../task/tasks.js";

export const WORKTREES_DIR = ".worktrees";
/** Ports handed to task worktrees start here (§6.2's example: 5174). */
export const FIRST_PORT = 5174;

export interface Isolation {
  task: string;
  /** Absolute path of the task's worktree. */
  worktree: string;
  branch: string;
  /** The ref the worktree was cut from, and the commit it resolved to. */
  baseRef: string;
  base: string;
  port: number;
  database: string;
}

const envPath = (repoPath: string, id: string) =>
  join(repoPath, TASKS_DIR, id, "env.json");

export async function loadIsolation(
  repoPath: string,
  id: string,
): Promise<Isolation | null> {
  try {
    return JSON.parse(
      await readFile(envPath(repoPath, id), "utf8"),
    ) as Isolation;
  } catch {
    return null;
  }
}

/** origin's default branch (origin/HEAD), else origin/main, else local main. */
async function defaultBase(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const remotes = await git.getRemotes();
  if (remotes.some((r) => r.name === "origin")) {
    await git.fetch("origin").catch(() => undefined);
    const head = await git
      .raw(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
      .catch(() => "");
    if (head.trim()) return head.trim().replace(/^refs\/remotes\//, "");
    return "origin/main";
  }
  return "main";
}

/** The lowest port no other isolated task holds. */
async function freePort(repoPath: string, tasks: string[]): Promise<number> {
  const taken = new Set<number>();
  for (const id of tasks) {
    const iso = await loadIsolation(repoPath, id);
    if (iso) taken.add(iso.port);
  }
  let port = FIRST_PORT;
  while (taken.has(port)) port++;
  return port;
}

/** Keep `.worktrees/` out of `git status` without touching a tracked file. */
async function excludeWorktrees(repoPath: string): Promise<void> {
  const path = (
    await simpleGit(repoPath).raw([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "info/exclude",
    ])
  ).trim();
  const text = await readFile(path, "utf8").catch(() => "");
  if (text.split(/\r?\n/).includes(`/${WORKTREES_DIR}/`)) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    `${text && !text.endsWith("\n") ? "\n" : ""}/${WORKTREES_DIR}/\n`,
  );
}

/**
 * `factory task isolate <id>` (the runtime does it after approval): create the
 * worktree and record it. Refuses until the route is approved, and twice.
 */
export async function isolateTask(
  repoPath: string,
  id: string,
  options: {
    by: string;
    now?: Date | undefined;
    base?: string | undefined;
    otherTasks?: string[] | undefined;
  },
): Promise<{ task: Task; isolation: Isolation }> {
  const task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not isolating`);
  if (!task.approved)
    throw new TaskError(
      `task ${id}'s route isn't approved: \`factory task approve ${id}\``,
    );
  if (await loadIsolation(repoPath, id))
    throw new TaskError(`task ${id} already has a worktree`);

  const git = simpleGit(repoPath);
  const baseRef = options.base ?? (await defaultBase(repoPath));
  const base = (await git.revparse([baseRef])).trim();
  const branch = `${task.card.type}/${id.toLowerCase()}`;
  const worktree = join(repoPath, WORKTREES_DIR, id);

  await excludeWorktrees(repoPath);
  await git.raw(["worktree", "add", "-b", branch, worktree, base]);
  // No hooks run inside the worktree: the repo's hooks are the repo's code,
  // and the runtime commits there itself.
  await git.raw(["config", "extensions.worktreeConfig", "true"]);
  // simple-git guards core.hooksPath against hook injection; this points it at
  // an empty directory we just made, the opposite of injection (as tier 1).
  const wt = simpleGit(worktree, { unsafe: { allowUnsafeHooksPath: true } });
  const gitDir = (await wt.raw(["rev-parse", "--absolute-git-dir"])).trim();
  const noHooks = join(gitDir, "factory-no-hooks");
  await mkdir(noHooks, { recursive: true });
  await wt.raw(["config", "--worktree", "core.hooksPath", noHooks]);

  const repoName = basename(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const isolation: Isolation = {
    task: id,
    worktree,
    branch,
    baseRef,
    base,
    port: await freePort(repoPath, options.otherTasks ?? []),
    database: `${repoName || "app"}_${id.toLowerCase().replace("-", "")}`,
  };
  await writeFile(
    envPath(repoPath, id),
    `${JSON.stringify(isolation, null, 2)}\n`,
    "utf8",
  );
  await task.ledger.append({
    beat: "isolate",
    section: "timeline",
    text: `worktree ${WORKTREES_DIR}/${id} · branch ${branch} from ${baseRef} (${base.slice(0, 12)}) · port ${isolation.port} · db ${isolation.database}`,
    by: `factory runtime (for ${options.by})`,
    at: options.now,
  });
  return { task: await loadTask(repoPath, id), isolation };
}
