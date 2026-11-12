// The task store (§8): `.factory/tasks/` is a working copy of the repo's
// `factory/tasks` branch, so a task's record lives in the repo, not on one
// machine. Each task directory is a subtree on that branch:
//
//   factory/tasks
//   ├── T-0001/            card.yml, assembly.yml, ledger.*, env.json, judge/,
//   │                      proof/, and lease.json (who holds the task, until when)
//   └── history.jsonl      one row per closed task
//
// Writes go through `commitTask`, which commits one task's subtree on top of
// the branch tip and pushes. Only that subtree changes (and history rows are
// appended), so a push that loses a race is redone on the new tip: two people
// working on different tasks never conflict. The lease keeps two runners off
// one task, and the push being fast-forward-only is what makes taking one safe.
// Without an origin remote the branch is local only, which is the single
// machine case.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { TASK_ID } from "./card.js";

export const TASKS_BRANCH = "factory/tasks";
const LOCAL = `refs/heads/${TASKS_BRANCH}`;
const REMOTE = `refs/remotes/origin/${TASKS_BRANCH}`;
const TASKS_DIR = join(".factory", "tasks");
/** A lease is good for this long after the holder last wrote the task. */
export const LEASE_MS = 2 * 60 * 60 * 1000;
/** How often a lost push race is retried on the new tip before giving up. */
const PUSH_ATTEMPTS = 5;

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

function git(
  cwd: string,
  args: string[],
  options: { input?: string | Buffer; env?: NodeJS.ProcessEnv } = {},
): Promise<GitResult> {
  return new Promise((done, fail) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", fail);
    child.on("close", (code) =>
      done({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
    child.stdin.end(options.input ?? "");
  });
}

async function gitOk(
  cwd: string,
  args: string[],
  options: { input?: string | Buffer; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const res = await git(cwd, args, options);
  if (res.code !== 0)
    throw new StoreError(
      `git ${args[0]} failed: ${res.stderr.trim() || `exit ${res.code}`}`,
    );
  return res.stdout;
}

const revParse = async (repo: string, ref: string) => {
  const res = await git(repo, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  return res.code === 0 ? res.stdout.trim() : null;
};

const hasOrigin = async (repo: string) =>
  (await git(repo, ["remote", "get-url", "origin"])).code === 0;

/** Who holds a task: the person, and the machine (one person, two machines, two holders). */
export const holderName = (who: string) => `${who} on ${hostname()}`;

export interface Lease {
  holder: string;
  /** ISO time; a lease past it can be taken by anyone. */
  expires: string;
}

/** What `commitTask` was refused for, so the caller can say who has the task. */
export class LeaseError extends StoreError {
  constructor(
    readonly id: string,
    readonly lease: Lease,
  ) {
    super(
      `${id} is held by ${lease.holder} until ${lease.expires}. It can be taken over after that, or sooner if they run \`factory task release ${id}\`.`,
    );
    this.name = "LeaseError";
  }
}

/**
 * Fetch the branch and point the local one at origin's. Returns the tip, or
 * null when there's no branch yet. The local branch is only a cache of
 * origin's: what this machine holds lives in its task directories, and
 * `commitTask` rebuilds a task's subtree from those, so nothing unpushed is
 * lost by following origin.
 */
async function fetchTip(repo: string): Promise<string | null> {
  if (await hasOrigin(repo)) {
    const res = await git(repo, [
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      `+${LOCAL}:${REMOTE}`,
    ]);
    if (res.code !== 0 && !/couldn't find remote ref/i.test(res.stderr))
      throw new StoreError(
        `couldn't fetch ${TASKS_BRANCH} from origin: ${res.stderr.trim()}`,
      );
    const remote = await revParse(repo, REMOTE);
    if (remote && remote !== (await revParse(repo, LOCAL)))
      await gitOk(repo, ["update-ref", LOCAL, remote]);
  }
  return revParse(repo, LOCAL);
}

/** The files of `tree` under `prefix`, as paths relative to it. */
async function treeFiles(
  repo: string,
  tree: string,
  prefix: string,
): Promise<string[]> {
  const out = await gitOk(repo, [
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    tree,
    "--",
    prefix,
  ]);
  return out
    .split("\0")
    .filter(Boolean)
    .map((p) => p.slice(prefix.length + 1));
}

async function readBlob(
  repo: string,
  rev: string,
  path: string,
): Promise<Buffer | null> {
  const res = await new Promise<{ code: number; data: Buffer }>((done) => {
    const child = spawn("git", ["cat-file", "blob", `${rev}:${path}`], {
      cwd: repo,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", () => done({ code: 1, data: Buffer.alloc(0) }));
    child.on("close", (code) =>
      done({ code: code ?? 1, data: Buffer.concat(chunks) }),
    );
  });
  return res.code === 0 ? res.data : null;
}

async function readLease(
  repo: string,
  rev: string | null,
  id: string,
): Promise<Lease | null> {
  if (!rev) return null;
  const blob = await readBlob(repo, rev, `${id}/lease.json`);
  if (!blob) return null;
  try {
    return JSON.parse(blob.toString("utf8")) as Lease;
  } catch {
    return null;
  }
}

/** The task ids on the branch tip. */
async function branchIds(repo: string, tip: string | null): Promise<string[]> {
  if (!tip) return [];
  const out = await gitOk(repo, ["ls-tree", "-z", "--name-only", tip]);
  return out.split("\0").filter((n) => TASK_ID.test(n));
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(
    () => [],
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** A task's files as path → blob id; `lease.json` aside (every write changes it). */
type Files = Map<string, string>;
const sameFiles = (a: Files, b: Files) =>
  a.size === b.size && [...a].every(([path, sha]) => b.get(path) === sha);

async function localFiles(repo: string, dir: string): Promise<Files> {
  const files = (await walk(dir)).filter((f) => f !== join(dir, "lease.json"));
  if (files.length === 0) return new Map();
  const shas = (
    await gitOk(repo, ["hash-object", "--no-filters", "--", ...files])
  )
    .trim()
    .split(/\r?\n/);
  return new Map(
    files.map((f, i) => [
      relative(dir, f).split(sep).join("/"),
      shas[i] as string,
    ]),
  );
}

async function branchFiles(
  repo: string,
  commit: string,
  id: string,
): Promise<Files> {
  const out = await gitOk(repo, ["ls-tree", "-r", "-z", commit, "--", id]);
  const files: Files = new Map();
  for (const line of out.split("\0").filter(Boolean)) {
    // "<mode> blob <sha>\t<id>/<path>"
    const [meta = "", path = ""] = line.split("\t");
    const rel = path.slice(id.length + 1);
    if (rel !== "lease.json") files.set(rel, meta.split(" ")[2] ?? "");
  }
  return files;
}

/**
 * Is this machine's copy of a task a state the branch already has (or is
 * there no copy)? If not, it holds work no push has carried yet.
 */
async function pushedBefore(
  repo: string,
  tip: string,
  id: string,
): Promise<boolean> {
  const local = await localFiles(repo, join(repo, TASKS_DIR, id));
  if (local.size === 0) return true;
  const commits = (await gitOk(repo, ["log", "--format=%H", tip, "--", id]))
    .split(/\s+/)
    .filter(Boolean);
  for (const commit of commits)
    if (sameFiles(local, await branchFiles(repo, commit, id))) return true;
  return false;
}

/**
 * Bring `.factory/tasks/` up to the branch: every task on it is written out,
 * unless this machine's copy holds work the branch has never had (a beat
 * whose push failed). That copy is kept, and its id returned, so nothing
 * unpushed is ever deleted: the next beat on the task pushes it. Tasks only
 * on this machine are left alone.
 */
export async function pullTasks(repo: string): Promise<{ kept: string[] }> {
  const kept: string[] = [];
  const tip = await fetchTip(repo);
  if (!tip) return { kept };
  for (const id of await branchIds(repo, tip)) {
    if (!(await pushedBefore(repo, tip, id))) {
      kept.push(id);
      continue;
    }
    const dir = join(repo, TASKS_DIR, id);
    await rm(dir, { recursive: true, force: true });
    for (const rel of await treeFiles(repo, tip, id)) {
      const path = join(dir, ...rel.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, (await readBlob(repo, tip, `${id}/${rel}`)) ?? "");
    }
  }
  return { kept };
}

export interface CommitOptions {
  /** Who is writing, as `holderName` gives it. */
  holder: string;
  /** The commit message's subject. */
  message: string;
  now?: Date;
  /** History rows to append to `history.jsonl` on the branch (§8). */
  history?: string[];
  /** Give the lease up instead of renewing it (the task is closed or released). */
  release?: boolean;
  /** Refuse unless the id is new on the branch (allocating it). */
  create?: boolean;
}

/**
 * Commit `.factory/tasks/<id>/` onto the branch tip and push it, renewing
 * (or releasing) `holder`'s lease. Refused with a `LeaseError` when someone
 * else holds a live lease, and with a `StoreError` (`create`) when the id
 * was taken. A lost push race is redone on the new tip.
 */
export async function commitTask(
  repo: string,
  id: string,
  options: CommitOptions,
): Promise<void> {
  const now = options.now ?? new Date();
  const dir = join(repo, TASKS_DIR, id);
  // Only a task that exists goes on the branch; `create` is the one exception.
  if (
    !options.create &&
    !(await readFile(join(dir, "card.yml")).then(
      () => true,
      () => false,
    ))
  )
    throw new StoreError(`no task ${id} here (no ${TASKS_DIR}/${id}/card.yml)`);
  const lease: Lease = {
    holder: options.holder,
    expires: new Date(
      now.getTime() + (options.release ? 0 : LEASE_MS),
    ).toISOString(),
  };

  const origin = await hasOrigin(repo);
  const scratch = await mkdtemp(join(tmpdir(), "factory-store-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    for (let attempt = 1; ; attempt++) {
      const tip = await fetchTip(repo);
      if (options.create && (await branchIds(repo, tip)).includes(id))
        throw new StoreError(`${id} is already on ${TASKS_BRANCH}`);
      const held = await readLease(repo, tip, id);
      if (
        held &&
        held.holder !== options.holder &&
        Date.parse(held.expires) > now.getTime()
      )
        throw new LeaseError(id, held);
      // The lease is ours (or free): take or renew it.
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "lease.json"),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      await rm(env.GIT_INDEX_FILE, { force: true });
      await gitOk(repo, tip ? ["read-tree", tip] : ["read-tree", "--empty"], {
        env,
      });
      await gitOk(
        repo,
        ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", id],
        {
          env,
        },
      );
      const files = await walk(dir);
      const shas = (
        await gitOk(repo, ["hash-object", "-w", "--no-filters", "--", ...files])
      )
        .trim()
        .split(/\r?\n/);
      const entries = files.map(
        (file, i) =>
          `100644 ${shas[i]}\t${id}/${relative(dir, file).split(sep).join("/")}`,
      );
      if (options.history?.length) {
        const have = (
          (tip && (await readBlob(repo, tip, "history.jsonl"))) ||
          ""
        ).toString();
        // One row per task: a close that's re-run doesn't add a second.
        const taskOf = (line: string) => {
          try {
            return (JSON.parse(line) as { task?: unknown }).task;
          } catch {
            return undefined;
          }
        };
        const done = new Set(have.split("\n").map(taskOf).filter(Boolean));
        const rows = options.history.filter((row) => {
          const task = taskOf(row);
          return task ? !done.has(task) : !have.split("\n").includes(row);
        });
        if (rows.length > 0) {
          const text = `${have}${have && !have.endsWith("\n") ? "\n" : ""}${rows.join("\n")}\n`;
          const sha = (
            await gitOk(repo, ["hash-object", "-w", "--stdin"], { input: text })
          ).trim();
          entries.push(`100644 ${sha}\thistory.jsonl`);
        }
      }
      await gitOk(repo, ["update-index", "--add", "--index-info"], {
        env,
        input: `${entries.join("\n")}\n`,
      });
      const tree = (await gitOk(repo, ["write-tree"], { env })).trim();
      const commit = (
        await gitOk(
          repo,
          [
            "commit-tree",
            tree,
            ...(tip ? ["-p", tip] : []),
            "-m",
            options.message,
          ],
          {
            env: {
              // The record's commits are the runtime's, whoever runs it.
              GIT_AUTHOR_NAME: "factory",
              GIT_AUTHOR_EMAIL: "factory@localhost",
              GIT_COMMITTER_NAME: "factory",
              GIT_COMMITTER_EMAIL: "factory@localhost",
            },
          },
        )
      ).trim();
      // Compare-and-swap: only moves the branch if nobody else did meanwhile
      // (another factory process on this machine); if somebody did, redo it.
      const swapped = await git(repo, ["update-ref", LOCAL, commit, tip ?? ""]);
      if (swapped.code !== 0) {
        if (attempt >= PUSH_ATTEMPTS)
          throw new StoreError(
            `couldn't move ${TASKS_BRANCH}: ${swapped.stderr.trim()}`,
          );
        continue;
      }
      if (!origin) return;
      const push = await git(repo, [
        "push",
        "--quiet",
        "--no-verify",
        "origin",
        `${LOCAL}:${LOCAL}`,
      ]);
      if (push.code === 0) {
        await gitOk(repo, ["update-ref", REMOTE, commit]);
        return;
      }
      const lostRace = /rejected|fetch first|non-fast-forward|stale info/i.test(
        push.stderr,
      );
      if (!lostRace || attempt >= PUSH_ATTEMPTS)
        throw new StoreError(
          `couldn't push ${TASKS_BRANCH} to origin: ${push.stderr.trim()}`,
        );
      // Somebody else wrote a task: drop our commit; the next round fetches
      // their tip and redoes it on top.
      await gitOk(
        repo,
        tip ? ["update-ref", LOCAL, tip] : ["update-ref", "-d", LOCAL],
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The lease on a task as the branch has it (after a fetch), or null. */
export async function taskLease(
  repo: string,
  id: string,
): Promise<Lease | null> {
  return readLease(repo, await fetchTip(repo), id);
}

/**
 * Allocate the next task id on the branch: the lowest `T-NNNN` above every id
 * there and here, reserved by pushing its lease. Two people allocating at once
 * both try the same id; the one whose push lands keeps it, the other moves on.
 */
export async function reserveTaskId(
  repo: string,
  options: { holder: string; now?: Date },
): Promise<string> {
  for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
    const tip = await fetchTip(repo);
    const local = await readdir(join(repo, TASKS_DIR)).catch(() => []);
    const numbers = [...(await branchIds(repo, tip)), ...local]
      .filter((n) => TASK_ID.test(n))
      .map((n) => Number(n.slice(2)));
    const id = `T-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
    try {
      await commitTask(repo, id, {
        holder: options.holder,
        message: `${id}: reserved`,
        create: true,
        ...(options.now ? { now: options.now } : {}),
      });
      return id;
    } catch (err) {
      if (!(err instanceof StoreError) || !/already on/.test(err.message))
        throw err;
      await rm(join(repo, TASKS_DIR, id), { recursive: true, force: true });
    }
  }
  throw new StoreError(`couldn't reserve a task id on ${TASKS_BRANCH}`);
}

export const leasePath = (repo: string, id: string) =>
  join(repo, TASKS_DIR, id, "lease.json");

/** This machine's copy of a task's lease, or null. */
export async function localLease(
  repo: string,
  id: string,
): Promise<Lease | null> {
  try {
    return JSON.parse(await readFile(leasePath(repo, id), "utf8")) as Lease;
  } catch {
    return null;
  }
}
