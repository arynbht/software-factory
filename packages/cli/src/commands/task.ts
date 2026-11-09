import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import {
  CardError,
  confirmTask,
  LedgerError,
  listTasks,
  loadTask,
  newTask,
  nextStep,
  parseAcceptanceFlag,
  type Task,
  TaskError,
  whoami,
} from "@arynbht/factory-runtime";
import { parse, stringify } from "yaml";

export interface TaskNewFlags {
  type?: string;
  description?: string;
  accept?: string[];
  outOfScope?: string[];
  touches?: string[];
  constraint?: string[];
  risk?: string;
  source?: string;
  from?: string;
  path?: string;
}

async function guarded(action: () => Promise<number>): Promise<number> {
  try {
    return await action();
  } catch (err) {
    if (
      err instanceof CardError ||
      err instanceof TaskError ||
      err instanceof LedgerError
    ) {
      console.error(`factory task: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

function describe(task: Task): string {
  const status =
    task.problems.length > 0
      ? "TAMPERED"
      : !task.confirmed
        ? "draft"
        : task.beat === "intake"
          ? "confirmed"
          : task.beat;
  return `${task.card.id}  ${status.padEnd(9)} ${task.card.title}`;
}

/** `factory task new "<title>"`: draft a card from flags or a YAML file. */
export function runTaskNew(
  title: string | undefined,
  flags: TaskNewFlags,
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const fromFile = flags.from
      ? ((parse(await readFile(resolve(flags.from), "utf8")) ?? {}) as Record<
          string,
          unknown
        >)
      : {};
    const input = {
      ...fromFile,
      ...(title ? { title } : {}),
      ...(flags.type ? { type: flags.type } : {}),
      ...(flags.description ? { description: flags.description } : {}),
      ...(flags.accept?.length
        ? { acceptance: flags.accept.map(parseAcceptanceFlag) }
        : {}),
      ...(flags.outOfScope?.length ? { out_of_scope: flags.outOfScope } : {}),
      ...(flags.touches?.length ? { touches: flags.touches } : {}),
      ...(flags.constraint?.length ? { constraints: flags.constraint } : {}),
      ...(flags.risk ? { risk: flags.risk } : {}),
      ...(flags.source ? { source: flags.source } : {}),
    } as Parameters<typeof newTask>[1];
    const task = await newTask(repo, input, { by: await whoami(repo) });
    process.stdout.write(
      `drafted ${task.card.id}: ${task.card.title}\n` +
        `review .factory/tasks/${task.card.id}/card.yml, then \`factory task confirm ${task.card.id}\`\n`,
    );
    return 0;
  });
}

/**
 * `factory task confirm <id>`: a person agrees the card. Shows it and asks at
 * the terminal; without one, `--yes` is required — and recorded as such.
 */
export function runTaskConfirm(
  id: string,
  flags: { yes?: boolean; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const task = await loadTask(repo, id);
    process.stdout.write(`${stringify(task.card)}\n`);
    if (!flags.yes) {
      if (!process.stdin.isTTY) {
        console.error(
          "factory task confirm: confirming a card needs a person at the terminal (or --yes).",
        );
        return 1;
      }
      const ok = await confirm({
        message: `Confirm ${id} as the agreed card?`,
      });
      if (isCancel(ok) || !ok) {
        process.stdout.write("not confirmed\n");
        return 1;
      }
    }
    const by = await whoami(repo);
    await confirmTask(repo, id, { by: flags.yes ? `${by} (--yes)` : by });
    process.stdout.write(`${id} confirmed; next: route\n`);
    return 0;
  });
}

/** `factory task status`: every task, its beat, and whether its record is intact. */
export function runTaskStatus(flags: { path?: string }): Promise<number> {
  return guarded(async () => {
    const tasks = await listTasks(resolve(flags.path ?? "."));
    if (tasks.length === 0) {
      process.stdout.write('no tasks yet: `factory task new "<title>"`\n');
      return 0;
    }
    for (const task of tasks) process.stdout.write(`${describe(task)}\n`);
    return tasks.some((t) => t.problems.length > 0) ? 1 : 0;
  });
}

/**
 * `factory task resume <id>`: verify the record, show the ledger, and say what
 * comes next — the point a restarted session picks up from.
 */
export function runTaskResume(
  id: string,
  flags: { path?: string },
): Promise<number> {
  return guarded(async () => {
    const task = await loadTask(resolve(flags.path ?? "."), id);
    if (task.problems.length > 0) {
      console.error(`factory task: ${id} fails verification; not resuming:`);
      for (const p of task.problems) console.error(`  - ${p}`);
      return 1;
    }
    process.stdout.write(await readFile(task.ledger.mdPath, "utf8"));
    process.stdout.write(`\nnext: ${nextStep(task)}\n`);
    return 0;
  });
}
