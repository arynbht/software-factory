import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";

import { parse, stringify } from "yaml";

import { type Card, type CardInput, parseCard, TASK_ID } from "./card.js";
import {
  type Beat,
  BEATS,
  isSeal,
  Ledger,
  type LedgerEntry,
} from "./ledger.js";

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
export const assemblyPath = (repoPath: string, id: string) =>
  join(taskDir(repoPath, id), "assembly.yml");
export const sha256 = (text: string) =>
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
  /** assembly.yml as written (unvalidated), once the task has been routed. */
  assemblyText?: string | undefined;
  /** The human approved the assembly (§3.2); its hash is sealed in the ledger. */
  approved: boolean;
  /** The beat of the latest entry. */
  beat: Beat;
  /** Ledger and card integrity problems (empty when intact). */
  problems: string[];
}

/** The confirmation entry seals the card: its text carries the card's hash. */
const CONFIRMED = /^intake confirmed; card sha256 ([0-9a-f]{64})$/;
/** Likewise the route approval seals the assembly. */
export const APPROVED = /^route approved; assembly sha256 ([0-9a-f]{64})$/;

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
  // Missing means not routed yet; any other read error is a real failure.
  const assemblyText = await readFile(assemblyPath(repoPath, id), "utf8").catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined;
      throw err;
    },
  );
  const approved = entries
    .map((e) => APPROVED.exec(e.text)?.[1])
    .find((hash) => hash !== undefined);
  if (approved && approved !== sha256(assemblyText ?? "")) {
    problems.push(
      assemblyText === undefined
        ? "assembly.yml is missing, but the route was approved"
        : "assembly.yml changed after the route was approved",
    );
  }
  return {
    card,
    ledger,
    entries,
    confirmed: sealed !== undefined,
    assemblyText,
    approved: approved !== undefined,
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

const ASKED = /^asked: /;
export const ANSWERED = /^answered: (allowed|denied)(?: — (.*))?$/;

/** Stop-and-ask questions raised since the last answer (§7.2). */
export function openStops(task: Task): string[] {
  const stops = task.entries.filter((e) => e.section === "stop");
  const last = stops.map((e) => ANSWERED.test(e.text)).lastIndexOf(true);
  return stops
    .slice(last + 1)
    .filter((e) => ASKED.test(e.text))
    .map((e) => e.text.replace(ASKED, ""));
}

const answerStep = (id: string) =>
  `stop-and-ask: \`factory task answer ${id} --allow\` or \`--deny "<why>"\``;

/** A judge verdict on the timeline; the head is the commit it judged. */
export const JUDGE_VERDICT =
  /^judge (passed|failed|needs a human) · round (\d+) · head ([0-9a-f]{12})/;

/** The judge's verdicts so far, oldest first. */
export function judgeVerdicts(
  task: Task,
): { verdict: string; round: number; head: string }[] {
  return task.entries.flatMap((e) => {
    const m =
      e.beat === "judge" && e.section === "timeline"
        ? JUDGE_VERDICT.exec(e.text)
        : null;
    return m ? [{ verdict: m[1]!, round: Number(m[2]), head: m[3]! }] : [];
  });
}

/** Where the judge beat stands: its latest verdict, or a person's answer to it. */
function judgeStep(task: Task): string {
  const id = task.card.id;
  if (openStops(task).length > 0) return answerStep(id);
  for (const e of [...task.entries].reverse()) {
    if (e.beat !== "judge") continue;
    const answer = e.section === "stop" ? ANSWERED.exec(e.text) : null;
    if (answer)
      return answer[1] === "allowed"
        ? "ship"
        : `build: \`factory task build ${id}\` (a person sent the change back)`;
    const verdict =
      e.section === "timeline" ? JUDGE_VERDICT.exec(e.text)?.[1] : undefined;
    if (verdict === "passed") return "ship";
    if (verdict === "failed")
      return `build: \`factory task build ${id}\` (the judge sent the change back)`;
  }
  return "judge";
}

/** Where the build beat stands, from its ledger entries. */
function buildStep(task: Task): string {
  const id = task.card.id;
  if (openStops(task).length > 0) return answerStep(id);
  const build = task.entries.filter((e) => e.beat === "build");
  const stage = [...build]
    .reverse()
    .find((e) => e.section === "timeline")
    ?.text.match(/^build (started|paused|done)/)?.[1];
  const answer = [...build]
    .reverse()
    .find((e) => e.section === "stop")
    ?.text.match(ANSWERED)?.[1];
  if (stage === "done" || (stage === "paused" && answer === "allowed"))
    return "prove";
  return `build: \`factory task build ${id}\``;
}

/** What happens next for a task, from its ledger. */
export function nextStep(task: Task): string {
  if (task.problems.length > 0)
    return "stop: the task record fails verification";
  if (!task.confirmed) return "intake: review the card and confirm it";
  if (!task.approved) {
    return task.assemblyText === undefined
      ? `route: \`factory task route ${task.card.id}\``
      : `route: review assembly.yml, then \`factory task approve ${task.card.id}\``;
  }
  const last = task.entries[task.entries.length - 1];
  if (last && isSeal(last)) return "done";
  if (task.beat === "close")
    return `close: \`factory task close ${task.card.id}\` (it stopped part-way)`;
  if (task.beat === "ship")
    return `close: once the PR is merged or closed, \`factory task close ${task.card.id}\``;
  if (task.beat === "judge") return judgeStep(task);
  if (task.beat === "build") return buildStep(task);
  if (task.beat === "prove") {
    const proved = [...task.entries]
      .reverse()
      .find((e) => e.beat === "prove" && e.section === "timeline");
    return proved?.text.startsWith("proof passed")
      ? "judge"
      : `build: \`factory task build ${task.card.id}\` (the proof failed)`;
  }
  if (task.beat === "isolate")
    return `build: \`factory task build ${task.card.id}\``;
  if (task.beat === "route")
    return `isolate: \`factory task isolate ${task.card.id}\``;
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
