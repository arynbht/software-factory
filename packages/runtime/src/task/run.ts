// `factory task run <id>`: after a person has confirmed the card and approved
// the route, take the task through isolate → build → prove → judge → ship,
// one beat at a time, and stop wherever a person is needed — a stop-and-ask
// question, a judge that needs a human, the open PR, or a build that keeps
// failing its proof. Each ledger entry is reported as it lands.
import { type AgentRunner, buildTask } from "../agent/build.js";
import { isolateTask } from "../agent/isolate.js";
import { judgeTask, type JudgeTaskOptions } from "../judge/task-judge.js";
import { proveTask, type ProveOptions } from "../proof/prove.js";
import { shipTask, type ShipOptions } from "../ship/ship.js";
import type { LedgerEntry } from "./ledger.js";
import { loadTask, nextStep, type Task, TaskError } from "./tasks.js";

/** Build rounds one run may start before it hands the task back to a person. */
export const MAX_BUILDS_PER_RUN = 4;

export interface RunTaskOptions {
  by: string;
  model?: string | undefined;
  /** The ref isolate cuts the worktree from (default: origin's default branch). */
  base?: string | undefined;
  /** Other tasks' ids, so isolate picks a free port. */
  otherTasks?: string[] | undefined;
  /** Called with each ledger entry as it lands. */
  onEntry?: ((entry: LedgerEntry) => void) | undefined;
  /** Replaceable in tests. */
  agent?: AgentRunner | undefined;
  prove?: Partial<ProveOptions> | undefined;
  judge?: Partial<JudgeTaskOptions> | undefined;
  ship?: Partial<ShipOptions> | undefined;
  now?: Date | undefined;
}

export interface RunOutcome {
  task: Task;
  /** The beats run, in order. */
  ran: string[];
  /** What the task waits on now (its next step). */
  next: string;
}

/** The beat a next step can be run by the driver, or null when a person acts. */
function runnable(
  next: string,
): "isolate" | "build" | "prove" | "judge" | "ship" | null {
  if (next.startsWith("isolate:")) return "isolate";
  if (next.startsWith("build:")) return "build";
  if (next === "prove" || next === "judge" || next === "ship") return next;
  return null;
}

export async function runTask(
  repoPath: string,
  id: string,
  options: RunTaskOptions,
): Promise<RunOutcome> {
  let task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not running`);
  if (!task.confirmed || !task.approved)
    throw new TaskError(
      `task ${id} needs a person first: ${nextStep(task)} (run only starts after the card is confirmed and the route approved)`,
    );
  let seen = task.entries.length;
  const report = async () => {
    task = await loadTask(repoPath, id);
    for (const e of task.entries.slice(seen)) options.onEntry?.(e);
    seen = task.entries.length;
  };

  const ran: string[] = [];
  let builds = 0;
  const common = { by: options.by, now: options.now };
  for (;;) {
    const next = nextStep(task);
    const beat = runnable(next);
    if (!beat) return { task, ran, next };
    if (beat === "build" && ++builds > MAX_BUILDS_PER_RUN)
      return {
        task,
        ran,
        next: `stopped after ${MAX_BUILDS_PER_RUN} build rounds without a passing proof and judge; read the ledger (\`factory task resume ${id}\`), then run again`,
      };
    ran.push(beat);
    try {
      if (beat === "isolate")
        await isolateTask(repoPath, id, {
          ...common,
          base: options.base,
          otherTasks: options.otherTasks,
        });
      else if (beat === "build")
        await buildTask(repoPath, id, {
          ...common,
          model: options.model,
          agent: options.agent,
        });
      else if (beat === "prove")
        await proveTask(repoPath, id, { ...options.prove, ...common });
      else if (beat === "judge")
        await judgeTask(repoPath, id, { ...options.judge, ...common });
      else {
        await shipTask(repoPath, id, { ...options.ship, ...common });
      }
    } finally {
      await report();
    }
  }
}
