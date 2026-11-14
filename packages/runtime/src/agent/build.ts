// The build beat (§3.4, §7.2): plan first (read-only, written to the ledger
// before any edit), then one writer in the task's worktree, then the runtime
// commits and checks the diff for stop-and-ask triggers. A trigger pauses the
// task until a person answers; an allowed trigger isn't asked about again.
import { spawn } from "node:child_process";

import {
  agentEnv,
  BUILD_TOOLS,
  claudeCommand,
  DENIED_BUILD_TOOLS,
  extractJson,
  ISOLATED_AGENT_ARGS,
  parseClaudeJson,
  READ_ONLY_TOOLS,
} from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";
import { parse } from "yaml";
import { z } from "zod";

import { AssemblySchema } from "../router/route.js";
import {
  ANSWERED,
  loadTask,
  openStops,
  type Task,
  TaskError,
} from "../task/tasks.js";
import { type Isolation, loadIsolation } from "./isolate.js";
import { assemblePrompt } from "./prompt.js";
import { findStops, type Stop } from "./stops.js";

export interface AgentCall {
  mode: "plan" | "build";
  system: string;
  prompt: string;
  cwd: string;
  model?: string | undefined;
  env: NodeJS.ProcessEnv;
}

/** An agent call's final text, with what it cost when the runner knows. */
export interface AgentReply {
  text: string;
  tokens?: number | undefined;
  costUsd?: number | undefined;
}

/** Runs one agent call and resolves its final text (or a reply with usage). */
export type AgentRunner = (call: AgentCall) => Promise<string | AgentReply>;

/** " · 12345 tokens · $0.42" for the ledger, or "" when unknown. */
export function usageNote(reply: AgentReply): string {
  return `${reply.tokens ? ` · ${reply.tokens} tokens` : ""}${reply.costUsd ? ` · $${reply.costUsd.toFixed(2)}` : ""}`;
}

const asReply = (r: string | AgentReply): AgentReply =>
  typeof r === "string" ? { text: r } : r;

export const claudeAgent: AgentRunner = async (call) => {
  const args = [
    "-p",
    "--output-format",
    "json",
    ...(call.model ? ["--model", call.model] : []),
    ...ISOLATED_AGENT_ARGS,
    "--append-system-prompt",
    call.system,
    ...(call.mode === "build"
      ? [
          "--permission-mode",
          "acceptEdits",
          "--allowedTools",
          BUILD_TOOLS.join(","),
          "--disallowedTools",
          DENIED_BUILD_TOOLS.join(","),
        ]
      : ["--allowedTools", READ_ONLY_TOOLS.join(",")]),
  ];
  const { command, argv } = await claudeCommand(args);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: call.cwd,
      env: call.env,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(err.trim() || `claude exited with code ${code}`)),
    );
    // A child that exits early closes stdin; its exit code says why, not EPIPE.
    child.stdin.on("error", () => undefined);
    child.stdin.end(call.prompt);
  });
  const text = parseClaudeJson(stdout, call.model ?? "").text;
  // The CLI's own totals: cache reads and writes included, cost as it reports it.
  const data = JSON.parse(stdout) as {
    total_cost_usd?: number;
    usage?: Record<string, number | undefined>;
  };
  const u = data.usage ?? {};
  const tokens = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ].reduce((sum, k) => sum + Number(u[k] ?? 0), 0);
  return {
    text,
    tokens: tokens || undefined,
    costUsd:
      typeof data.total_cost_usd === "number" ? data.total_cost_usd : undefined,
  };
};

const PLAN_SYSTEM =
  'Plan the task below before anyone edits a file. Read what you need; change nothing. Reply with ONLY a JSON object: {"steps": ["one concrete step", ...]}. Keep within the budget in the operating rules.';
const PlanSchema = z.object({ steps: z.array(z.string().min(1)).min(1) });

/** Details a person already allowed, so a rebuild doesn't ask again. */
function allowedDetails(task: Task): Set<string> {
  const allowed = new Set<string>();
  const stops = task.entries.filter((e) => e.section === "stop");
  let pending: string[] = [];
  for (const e of stops) {
    if (e.text.startsWith("asked: "))
      pending.push(e.text.slice("asked: ".length));
    const m = ANSWERED.exec(e.text);
    if (m) {
      if (m[1] === "allowed") for (const p of pending) allowed.add(p);
      pending = [];
    }
  }
  return allowed;
}

const ROUND_END = /^build (done|paused)/;
const PLAN_START = /^build started/;

/**
 * The answer the next round has to act on: one given since the last build
 * round ended, with the stops it answered. An older answer was acted on already.
 */
function pendingAnswer(
  task: Task,
): { allowed: boolean; note: string; stops: string[] } | null {
  let roundEnd = -1;
  task.entries.forEach((e, i) => {
    // A replan after a budget denial (build started) acts on it too.
    if (
      e.section === "timeline" &&
      (ROUND_END.test(e.text) || PLAN_START.test(e.text))
    )
      roundEnd = i;
  });
  let asked: string[] = [];
  let pending: { allowed: boolean; note: string; stops: string[] } | null =
    null;
  task.entries.forEach((e, i) => {
    if (e.section !== "stop") return;
    if (e.text.startsWith("asked: ")) {
      asked.push(e.text.slice("asked: ".length));
      return;
    }
    const m = ANSWERED.exec(e.text);
    if (!m) return;
    if (i > roundEnd)
      pending = { allowed: m[1] === "allowed", note: m[2] ?? "", stops: asked };
    asked = [];
  });
  return pending;
}

/** Judge lines the agent acts on: failed checks, blocking findings, unmet criteria. */
const JUDGE_FEEDBACK = /^(tier 1 fail|blocking|acceptance \S+: unmet)/;

/**
 * What the last proof or judge said, when it sent the change back after the
 * last build round.
 */
function sentBack(task: Task): string | undefined {
  let roundEnd = -1;
  task.entries.forEach((e, i) => {
    if (e.section === "timeline" && ROUND_END.test(e.text)) roundEnd = i;
  });
  const after = task.entries.slice(roundEnd + 1);
  const verdict = [...after]
    .reverse()
    .find(
      (e) =>
        (e.beat === "prove" || e.beat === "judge") && e.section === "timeline",
    );
  if (verdict?.text.startsWith("proof failed")) {
    const lines = after
      .filter((e) => e.beat === "prove" && e.section === "proof")
      .map((e) => e.text);
    return `the proof failed; fix the change so it passes — ${lines.join(" | ")}`;
  }
  if (verdict?.text.startsWith("judge failed")) {
    const lines = after
      .filter((e) => e.section === "judge" && JUDGE_FEEDBACK.test(e.text))
      .map((e) => e.text);
    return `the judge sent the change back; fix these and nothing else — ${lines.join(" | ")}`;
  }
  return undefined;
}

/** The latest plan: the plan entries after the last "build started". */
function plan(task: Task): string[] {
  let start = -1;
  task.entries.forEach((e, i) => {
    if (e.section === "timeline" && PLAN_START.test(e.text)) start = i;
  });
  return task.entries
    .slice(start + 1)
    .filter((e) => e.section === "plan")
    .map((e) => e.text.replace(/^\d+\. /, ""));
}

export interface BuildOutcome {
  task: Task;
  /** Stops raised this round; empty when the build finished. */
  stops: Stop[];
  commit?: string | undefined;
}

/**
 * `factory task build <id>`: plan (once), build, commit, check. Returns the
 * stops it raised; the task waits on `factory task answer` until they're answered.
 */
export async function buildTask(
  repoPath: string,
  id: string,
  options: {
    by: string;
    agent?: AgentRunner | undefined;
    model?: string | undefined;
    now?: Date | undefined;
  },
): Promise<BuildOutcome> {
  const agent = options.agent ?? claudeAgent;
  let task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not building`);
  const isolation = await loadIsolation(repoPath, id);
  if (!isolation)
    throw new TaskError(
      `task ${id} has no worktree: \`factory task isolate ${id}\``,
    );
  if (openStops(task).length > 0)
    throw new TaskError(
      `task ${id} is waiting on an answer: \`factory task answer ${id} --allow|--deny\``,
    );
  const assembly = AssemblySchema.parse(parse(task.assemblyText ?? ""));
  const by = `factory runtime (for ${options.by})`;
  const log = (section: "timeline" | "plan" | "stop", text: string) =>
    task.ledger.append({ beat: "build", section, text, by, at: options.now });
  const env = taskEnv(isolation);

  const answer = pendingAnswer(task);
  // A denied over-budget plan is replanned, never run.
  const replan =
    answer !== null &&
    !answer.allowed &&
    answer.stops.some((s) => s.startsWith("budget_exhausted"));

  // Plan first, recorded before any edit.
  let steps = replan ? [] : plan(task);
  if (steps.length === 0) {
    const planning = await assemblePrompt({
      repoPath,
      card: task.card,
      assembly,
      isolation,
      answer: replan
        ? `your plan was over budget and was refused — ${answer.note || "plan fewer, larger steps"}`
        : undefined,
    });
    const reply = asReply(
      await agent({
        mode: "plan",
        system: PLAN_SYSTEM,
        prompt: planning.prompt,
        cwd: isolation.worktree,
        model: options.model,
        env,
      }),
    );
    steps = PlanSchema.parse(extractJson(reply.text)).steps;
    await log(
      "timeline",
      `build started · skills ${planning.skills.join(", ") || "spine only"} · budget ${assembly.budget.steps} steps / ${assembly.budget.context_tokens / 1000}k ctx · ${planning.files.length} repo file(s) in context${usageNote(reply)}`,
    );
    for (const [i, step] of steps.entries())
      await log("plan", `${i + 1}. ${step}`);
    if (steps.length > assembly.budget.steps) {
      const stop: Stop = {
        trigger: "budget_exhausted",
        detail: `the plan has ${steps.length} steps; the budget is ${assembly.budget.steps}`,
      };
      await log("stop", `asked: ${stop.trigger}: ${stop.detail}`);
      return { task: await loadTask(repoPath, id), stops: [stop] };
    }
  }

  const building = await assemblePrompt({
    repoPath,
    card: task.card,
    assembly,
    isolation,
    plan: steps,
    answer:
      answer && !answer.allowed && !replan
        ? `denied — ${answer.note || "undo what you asked about"}`
        : sentBack(task),
  });
  const reply = asReply(
    await agent({
      mode: "build",
      system: building.system,
      prompt: building.prompt,
      cwd: isolation.worktree,
      model: options.model,
      env,
    }),
  );

  // The runtime commits, with hooks off (the worktree's hooksPath is empty).
  const wt = simpleGit(isolation.worktree);
  await wt.add(["-A"]);
  const staged = (await wt.raw(["diff", "--cached", "--name-only"])).trim();
  if (staged)
    await wt.commit(
      `${task.card.type}(${id.toLowerCase()}): ${task.card.title}`,
      ["--no-verify"],
    );
  const head = (await wt.revparse(["HEAD"])).trim();

  task = await loadTask(repoPath, id);
  const allowed = allowedDetails(task);
  const found = await findStops(
    isolation.worktree,
    isolation.base,
    head,
    assembly,
  );
  // The agent did nothing and the branch still changes nothing: it couldn't
  // or wouldn't start. (Undoing a denied change is doing something.) Proving
  // the base would only fail or pass for nothing, so a person reads why and
  // answers (deny with a note to say what to do).
  if (
    !staged &&
    !(await wt.raw(["diff", "--name-only", isolation.base, head])).trim()
  )
    found.push({
      trigger: "no_change",
      detail:
        reply.text.trim().split("\n")[0]?.slice(0, 300) ||
        "the agent changed nothing and said nothing",
    });
  const stops = found.filter((s) => !allowed.has(`${s.trigger}: ${s.detail}`));
  for (const s of stops) await log("stop", `asked: ${s.trigger}: ${s.detail}`);
  await log(
    "timeline",
    stops.length > 0
      ? `build paused: ${stops.length} thing(s) to ask about · commit ${head.slice(0, 12)}${usageNote(reply)}`
      : `build done · commit ${head.slice(0, 12)} · ${staged ? staged.split("\n").length : 0} file(s) this round${usageNote(reply)} · ${reply.text.trim().split("\n")[0]?.slice(0, 200) ?? ""}`,
  );
  return { task: await loadTask(repoPath, id), stops, commit: head };
}

/**
 * `factory task answer <id> --allow|--deny [note]`: a person answers the open
 * stops. Allowed: the task moves on (and isn't asked again). Denied: the next
 * build round gets the note and undoes it.
 */
export async function answerStops(
  repoPath: string,
  id: string,
  options: {
    allow: boolean;
    note?: string | undefined;
    by: string;
    now?: Date | undefined;
  },
): Promise<Task> {
  const task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification`);
  if (openStops(task).length === 0)
    throw new TaskError(`task ${id} has nothing waiting on an answer`);
  const note = options.note?.replace(/\s+/g, " ").trim();
  // The answer belongs to the beat that asked: build, or the judge.
  const asked = [...task.entries]
    .reverse()
    .find((e) => e.section === "stop" && e.text.startsWith("asked: "));
  await task.ledger.append({
    beat: asked?.beat === "judge" ? "judge" : "build",
    section: "stop",
    text: `answered: ${options.allow ? "allowed" : "denied"}${note ? ` — ${note}` : ""}`,
    by: options.by,
    at: options.now,
  });
  return loadTask(repoPath, id);
}

/**
 * The agent's environment: the engine's write-agent env (no caller tokens reach
 * the repo code it runs) plus the worktree's port and database.
 */
function taskEnv(isolation: Isolation): NodeJS.ProcessEnv {
  return agentEnv({
    PORT: String(isolation.port),
    FACTORY_TASK: isolation.task,
    FACTORY_DATABASE: isolation.database,
  });
}
