import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";

import { parse, stringify } from "yaml";

import { type Card, type CardInput, parseCard, TASK_ID } from "./card.js";
import { type Beat, BEATS, Ledger, type LedgerEntry } from "./ledger.js";

export const TASKS_DIR = ".factory/tasks";

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

const taskDir = (repoPath: string, id: string) => join(repoPath, TASKS_DIR, id);
const cardPath = (repoPath: string, id: string) =>
  join(taskDir(repoPath, id), "card.yml");
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Task records are per-machine working state: keep them out of git. */
async function ignoreTasks(repoPath: string): Promise<void> {
  const path = join(repoPath, ".factory", ".gitignore");
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    // new file
  }
  if (/^tasks\/$/m.test(text)) return;
  await mkdir(join(repoPath, ".factory"), { recursive: true });
  await writeFile(
    path,
    `${text}${text && !text.endsWith("\n") ? "\n" : ""}tasks/\n`,
    "utf8",
  );
}

async function taskIds(repoPath: string): Promise<string[]> {
  try {
    return (await readdir(join(repoPath, TASKS_DIR)))
      .filter((n) => TASK_ID.test(n))
      .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  } catch {
    return [];
  }
}

export async function nextTaskId(repoPath: string): Promise<string> {
  const ids = await taskIds(repoPath);
  const last = ids.length > 0 ? Number(ids[ids.length - 1]?.slice(2)) : 0;
  return `T-${String(last + 1).padStart(4, "0")}`;
}

export interface Task {
  card: Card;
  ledger: Ledger;
  entries: LedgerEntry[];
  confirmed: boolean;
  /** The beat of the latest entry. */
  beat: Beat;
  /** Ledger and card integrity problems (empty when intact). */
  problems: string[];
}

/** The confirmation entry seals the card: its text carries the card's hash. */
const CONFIRMED = /^intake confirmed; card sha256 ([0-9a-f]{64})$/;

export async function loadTask(repoPath: string, id: string): Promise<Task> {
  let text: string;
  try {
    text = await readFile(cardPath(repoPath, id), "utf8");
  } catch {
    throw new TaskError(
      `no task ${id} (looked in ${TASKS_DIR}/${id}/card.yml)`,
    );
  }
  const card = parseCard(parse(text));
  const ledger = await Ledger.open(
    taskDir(repoPath, id),
    `${card.id} · ${card.title}`,
  );
  const entries = await ledger.entries();
  const { problems } = await ledger.verify();
  const sealed = entries
    .map((e) => CONFIRMED.exec(e.text)?.[1])
    .find((hash) => hash !== undefined);
  if (sealed && sealed !== sha256(text)) {
    problems.push("card.yml changed after intake was confirmed");
  }
  return {
    card,
    ledger,
    entries,
    confirmed: sealed !== undefined,
    beat: entries[entries.length - 1]?.beat ?? "intake",
    problems,
  };
}

/**
 * `factory task new`: validate a draft card (acceptance items with a `verify`
 * each, or it is refused), write it, and open the ledger. Nothing runs on the
 * card until a human confirms it.
 */
export async function newTask(
  repoPath: string,
  input: Omit<CardInput, "id" | "created" | "owner"> & {
    owner?: string | undefined;
  },
  options: { by: string; now?: Date | undefined },
): Promise<Task> {
  const now = options.now ?? new Date();
  const id = await nextTaskId(repoPath);
  const card = parseCard({
    ...input,
    id,
    owner: input.owner ?? options.by,
    created: now.toISOString().slice(0, 10),
  });
  await ignoreTasks(repoPath);
  await mkdir(taskDir(repoPath, id), { recursive: true });
  await writeFile(cardPath(repoPath, id), stringify(card), "utf8");
  const ledger = await Ledger.open(
    taskDir(repoPath, id),
    `${card.id} · ${card.title}`,
  );
  await ledger.append({
    beat: "intake",
    section: "timeline",
    text: `card drafted with ${card.acceptance.length} acceptance criteria; awaiting confirmation`,
    by: options.by,
    at: now,
  });
  return loadTask(repoPath, id);
}

/**
 * `factory task confirm`: the human agrees the card. Re-validates it (it may
 * have been edited as a draft) and seals its hash into the ledger, so a later
 * edit to the card is detected.
 */
export async function confirmTask(
  repoPath: string,
  id: string,
  options: { by: string; now?: Date | undefined },
): Promise<Task> {
  const task = await loadTask(repoPath, id);
  if (task.problems.length > 0) {
    throw new TaskError(
      `task ${id} fails verification:\n${task.problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  if (task.confirmed) throw new TaskError(`task ${id} is already confirmed`);
  const text = await readFile(cardPath(repoPath, id), "utf8");
  await task.ledger.append({
    beat: "intake",
    section: "timeline",
    text: `intake confirmed; card sha256 ${sha256(text)}`,
    by: options.by,
    at: options.now,
  });
  return loadTask(repoPath, id);
}

/** What happens next for a task, from its ledger. */
export function nextStep(task: Task): string {
  if (task.problems.length > 0)
    return "stop: the task record fails verification";
  if (!task.confirmed) return "intake: review the card and confirm it";
  const last = task.entries[task.entries.length - 1];
  if (last?.beat === "close") return "done";
  const i = BEATS.indexOf(task.beat);
  return `${BEATS[Math.min(i + 1, BEATS.length - 1)]}`;
}

/** `factory task status`: every task, its beat, and whether its record is intact. */
export async function listTasks(repoPath: string): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const id of await taskIds(repoPath))
    tasks.push(await loadTask(repoPath, id));
  return tasks;
}

/** Who is acting, for the ledger: git's user.email, else user.name, else the OS user. */
export async function whoami(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  for (const key of ["user.email", "user.name"]) {
    try {
      const value = (await git.getConfig(key)).value?.trim();
      if (value) return value;
    } catch {
      // not a repo, or no config
    }
  }
  return userInfo().username;
}
