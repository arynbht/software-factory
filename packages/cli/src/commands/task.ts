import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import { RegistryError } from "@arynbht/factory-registry";
import {
  answerStops,
  approveRoute,
  buildTask,
  CardError,
  closeTask,
  commitTask,
  type CommitOptions,
  holderName,
  isolateTask,
  judgeTask,
  confirmTask,
  LedgerError,
  listTasks,
  loadTask,
  localLease,
  newTask,
  nextStep,
  parseAcceptanceFlag,
  parseCard,
  proveTask,
  pullTasks,
  reserveTaskId,
  routeTask,
  runTask,
  sha256,
  shipTask,
  StoreError,
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
  page?: string[];
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
      err instanceof LedgerError ||
      err instanceof RegistryError ||
      err instanceof StoreError
    ) {
      console.error(`factory task: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

/**
 * Run one beat of task `id` against the tasks branch (§8): pull the record,
 * take or renew this machine's lease (refused, before anything runs, while
 * someone else holds it), run, and push what the beat wrote, even when it
 * failed part-way, so the record never only lives here.
 */
async function onTask<T>(
  repo: string,
  id: string,
  beat: string,
  action: (by: string) => Promise<T>,
  finish: (result: T) => Partial<CommitOptions> = () => ({}),
): Promise<T> {
  const by = await whoami(repo);
  const holder = holderName(by);
  await pullTasks(repo, { holder });
  await commitTask(repo, id, { holder, message: `${id}: ${beat}` });
  let result: T;
  try {
    result = await action(by);
  } catch (err) {
    // Push what it got through; the beat's own error is the one to report.
    await commitTask(repo, id, {
      holder,
      message: `${id}: ${beat} failed`,
    }).catch(() => undefined);
    throw err;
  }
  await commitTask(repo, id, {
    holder,
    message: `${id}: ${beat} done`,
    ...finish(result),
  });
  return result;
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
      ...(flags.page?.length ? { pages: flags.page } : {}),
      ...(flags.constraint?.length ? { constraints: flags.constraint } : {}),
      ...(flags.risk ? { risk: flags.risk } : {}),
      ...(flags.source ? { source: flags.source } : {}),
    } as Parameters<typeof newTask>[1];
    const by = await whoami(repo);
    // Refuse a bad card before an id is reserved for it on the branch.
    parseCard({ ...input, id: "T-0000", owner: by, created: "2000-01-01" });
    const holder = holderName(by);
    const id = await reserveTaskId(repo, { holder });
    const task = await newTask(repo, input, { by, id });
    await commitTask(repo, id, { holder, message: `${id}: drafted` });
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
    await pullTasks(repo, { holder: holderName(await whoami(repo)) });
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
    await onTask(repo, id, "confirm", (by) =>
      confirmTask(repo, id, { by: flags.yes ? `${by} (--yes)` : by }),
    );
    process.stdout.write(`${id} confirmed; next: route\n`);
    return 0;
  });
}

/** `factory task status`: every task, its beat, and whether its record is intact. */
export function runTaskStatus(flags: { path?: string }): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    await pullTasks(repo, { holder: holderName(await whoami(repo)) });
    const tasks = await listTasks(repo);
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
    const repo = resolve(flags.path ?? ".");
    const holder = holderName(await whoami(repo));
    await pullTasks(repo, { holder });
    const task = await loadTask(repo, id);
    const lease = await localLease(repo, id);
    const held =
      lease && Date.parse(lease.expires) > Date.now() ? lease : undefined;
    if (task.problems.length > 0) {
      console.error(`factory task: ${id} fails verification; not resuming:`);
      for (const p of task.problems) console.error(`  - ${p}`);
      if (held && held.holder !== holder)
        console.error(
          `  (${id} was recorded by ${held.holder}. A ledger signed on another machine only verifies with the same key: set FACTORY_LEDGER_KEY to the team's key.)`,
        );
      return 1;
    }
    process.stdout.write(await readFile(task.ledger.mdPath, "utf8"));
    if (held)
      process.stdout.write(
        `\nheld by ${held.holder} until ${held.expires}${held.holder === holder ? " (this machine)" : `; it can be taken over after that, or once they run \`factory task release ${id}\``}\n`,
      );
    process.stdout.write(`\nnext: ${nextStep(task)}\n`);
    return 0;
  });
}

/**
 * `factory task release <id>`: give up this machine's lease, so someone else
 * can take the task over now instead of when the lease runs out.
 */
export function runTaskRelease(
  id: string,
  flags: { path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const holder = holderName(await whoami(repo));
    await pullTasks(repo, { holder });
    await commitTask(repo, id, {
      holder,
      message: `${id}: released`,
      release: true,
    });
    process.stdout.write(
      `${id} released: the next person to run one of its beats takes it over\n`,
    );
    return 0;
  });
}

/**
 * `factory task route <id>`: route the confirmed card and show the proposed
 * assembly with the reasons behind it; nothing is approved yet.
 */
export function runTaskRoute(
  id: string,
  flags: { path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const { routing } = await onTask(repo, id, "route", (by) =>
      routeTask(repo, id, { by }),
    );
    const out: string[] = ["sectors:"];
    for (const s of routing.scores) {
      const mark = routing.assembly.sectors.includes(s.sector) ? "in" : "  ";
      out.push(`  ${mark} ${s.sector} ${s.score}: ${s.reasons.join("; ")}`);
    }
    if (routing.borderline.length > 0)
      out.push(
        `under the threshold (add them to the assembly if they belong): ${routing.borderline.join(", ")}`,
      );
    for (const note of routing.notes) out.push(`note: ${note}`);
    out.push("", stringify(routing.assembly).trimEnd(), "");
    out.push(
      `wrote .factory/tasks/${id}/assembly.yml; edit it if you disagree, then \`factory task approve ${id}\``,
    );
    process.stdout.write(`${out.join("\n")}\n`);
    return 0;
  });
}

/**
 * `factory task approve <id>`: a person agrees the assembly — the last
 * approval before the agent starts. As with confirm, `--yes` without a
 * terminal, recorded as such.
 */
export function runTaskApprove(
  id: string,
  flags: { yes?: boolean; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    await pullTasks(repo, { holder: holderName(await whoami(repo)) });
    const task = await loadTask(repo, id);
    // Say what's wrong before asking anyone to approve anything.
    if (task.approved) {
      console.error(`factory task: ${id}'s route is already approved`);
      return 1;
    }
    if (task.assemblyText === undefined) {
      console.error(
        `factory task: ${id} hasn't been routed: \`factory task route ${id}\``,
      );
      return 1;
    }
    const shown = sha256(task.assemblyText);
    process.stdout.write(`${task.assemblyText}\n`);
    if (!flags.yes) {
      if (!process.stdin.isTTY) {
        console.error(
          "factory task approve: approving an assembly needs a person at the terminal (or --yes).",
        );
        return 1;
      }
      const ok = await confirm({
        message: `Approve this assembly for ${id}?`,
      });
      if (isCancel(ok) || !ok) {
        process.stdout.write("not approved\n");
        return 1;
      }
    }
    await onTask(repo, id, "approve", (by) =>
      approveRoute(repo, id, { by: flags.yes ? `${by} (--yes)` : by, shown }),
    );
    process.stdout.write(`${id} route approved; next: isolate\n`);
    return 0;
  });
}

/** `factory task isolate <id>`: the task's worktree, branch, port and database. */
export function runTaskIsolate(
  id: string,
  flags: { base?: string; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    // A closed task's port is free again.
    const others = (await listTasks(repo))
      .filter((t) => nextStep(t) !== "done")
      .map((t) => t.card.id);
    const { isolation } = await onTask(repo, id, "isolate", (by) =>
      isolateTask(repo, id, { by, base: flags.base, otherTasks: others }),
    );
    process.stdout.write(
      `${id}: worktree ${isolation.worktree} on ${isolation.branch} from ${isolation.baseRef} · port ${isolation.port} · db ${isolation.database}\nnext: \`factory task build ${id}\`\n`,
    );
    return 0;
  });
}

/**
 * `factory task build <id>`: plan, then build in the worktree; pauses on
 * anything the operating rules say to ask about.
 */
export function runTaskBuild(
  id: string,
  flags: { model?: string; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const outcome = await onTask(repo, id, "build", (by) =>
      buildTask(repo, id, { by, model: flags.model }),
    );
    for (const s of outcome.stops)
      process.stdout.write(`stop: ${s.trigger}: ${s.detail}\n`);
    process.stdout.write(`next: ${nextStep(outcome.task)}\n`);
    return outcome.stops.length > 0 ? 2 : 0;
  });
}

/** `factory task answer <id> --allow|--deny [note]`: answer the open stops. */
export function runTaskAnswer(
  id: string,
  note: string | undefined,
  flags: { allow?: boolean; deny?: boolean; path?: string },
): Promise<number> {
  return guarded(async () => {
    if (Boolean(flags.allow) === Boolean(flags.deny)) {
      console.error("factory task answer: give one of --allow or --deny.");
      return 1;
    }
    const repo = resolve(flags.path ?? ".");
    const task = await onTask(repo, id, "answer", (by) =>
      answerStops(repo, id, { allow: Boolean(flags.allow), note, by }),
    );
    process.stdout.write(`next: ${nextStep(task)}\n`);
    return 0;
  });
}

/** `factory task prove <id>`: run the assembly's proof and record it. */
export function runTaskProve(
  id: string,
  flags: { path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const { task, record } = await onTask(repo, id, "prove", (by) =>
      proveTask(repo, id, { by }),
    );
    for (const line of record.lines) process.stdout.write(`${line}\n`);
    process.stdout.write(
      `proof ${record.passed ? "passed" : "failed"}; next: ${nextStep(task)}\n`,
    );
    return record.passed ? 0 : 1;
  });
}

/**
 * `factory task judge <id>`: tier 1 and tier 2 on the task's branch. Exits 0
 * when it passed, 1 when it went back to build, 2 when it needs a person.
 */
export function runTaskJudge(
  id: string,
  flags: { model?: string; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const { task, record } = await onTask(repo, id, "judge", (by) =>
      judgeTask(repo, id, {
        by,
        model: flags.model,
        log: (line) => process.stderr.write(`· ${line}\n`),
      }),
    );
    if (record.review) process.stdout.write(`${record.review.body}\n\n`);
    process.stdout.write(
      `judge ${record.verdict} (round ${record.round}); next: ${nextStep(task)}\n`,
    );
    return record.verdict === "passed"
      ? 0
      : record.verdict === "failed"
        ? 1
        : 2;
  });
}

/** `factory task ship <id>`: push the judged branch and open its draft PR. */
export function runTaskShip(
  id: string,
  flags: { path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const { task, pr } = await onTask(repo, id, "ship", (by) =>
      shipTask(repo, id, { by }),
    );
    process.stdout.write(
      `${pr.reused ? "updated" : "opened"} draft PR #${pr.number}: ${pr.url}\nnext: ${nextStep(task)}\n`,
    );
    return 0;
  });
}

/** `factory task close <id> [--abandon "<why>"]`: record the outcome and seal the ledger. */
export function runTaskClose(
  id: string,
  flags: { abandon?: string | boolean; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const { row } = await onTask(
      repo,
      id,
      "close",
      (by) =>
        closeTask(repo, id, {
          by,
          // `--abandon` alone gives no reason; that's allowed.
          abandon:
            typeof flags.abandon === "string"
              ? flags.abandon
              : flags.abandon
                ? ""
                : undefined,
        }),
      // A closed task's lease is given up, and its row joins the history.
      ({ row }) => ({ release: true, history: [JSON.stringify(row)] }),
    );
    process.stdout.write(
      `${id} closed: ${row.outcome}${row.pr ? ` (PR #${row.pr})` : ""} · ${row.minutes} min · ${row.tokens} tokens · $${row.cost_usd.toFixed(2)}; ledger sealed\n`,
    );
    return 0;
  });
}

/**
 * `factory task run <id>`: isolate → build → prove → judge → ship, reporting
 * each ledger entry, until a person is needed. Exits 0 when it shipped, 2 when
 * it waits on a person, 1 on an error.
 */
export function runTaskRun(
  id: string,
  flags: { model?: string; base?: string; path?: string },
): Promise<number> {
  return guarded(async () => {
    const repo = resolve(flags.path ?? ".");
    const others = (await listTasks(repo))
      .filter((t) => t.card.id !== id && nextStep(t) !== "done")
      .map((t) => t.card.id);
    const outcome = await onTask(repo, id, "run", (by) =>
      runTask(repo, id, {
        by,
        model: flags.model,
        base: flags.base,
        otherTasks: others,
        onEntry: (e) =>
          process.stdout.write(
            `${e.at.slice(11, 16)} ${e.beat}${e.section === "timeline" ? "" : ` (${e.section})`}: ${e.text}\n`,
          ),
        judge: { log: (line) => process.stderr.write(`· ${line}\n`) },
      }),
    );
    process.stdout.write(`next: ${outcome.next}\n`);
    return outcome.ran.at(-1) === "ship" ? 0 : 2;
  });
}
