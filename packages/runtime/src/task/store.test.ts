import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  commitTask,
  LeaseError,
  pullTasks,
  reserveTaskId,
  StoreError,
  taskLease,
  TASKS_BRANCH,
} from "./store.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** An origin and two clones of it: two machines working on one repo. */
async function twoMachines(): Promise<{
  origin: string;
  a: string;
  b: string;
}> {
  const origin = await tmp("factory-origin-");
  git(origin, "init", "--bare", "-b", "main");
  const seed = await tmp("factory-seed-");
  git(seed, "init", "-b", "main");
  git(seed, "config", "user.email", "t@t");
  git(seed, "config", "user.name", "t");
  await writeFile(join(seed, "README.md"), "# demo\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "base", "--no-verify");
  git(seed, "push", "-q", origin, "main");
  const clone = async () => {
    const dir = await tmp("factory-clone-");
    git(dir, "clone", "-q", origin, ".");
    return dir;
  };
  return { origin, a: await clone(), b: await clone() };
}

const writeTask = async (repo: string, id: string, ledger: string) => {
  const dir = join(repo, ".factory", "tasks", id);
  await mkdir(join(dir, "judge"), { recursive: true });
  await writeFile(join(dir, "card.yml"), `id: ${id}\n`);
  await writeFile(join(dir, "ledger.jsonl"), ledger);
  await writeFile(join(dir, "judge", "round-1.json"), "{}\n");
};
const read = (repo: string, ...p: string[]) =>
  readFile(join(repo, ".factory", "tasks", ...p), "utf8");

const NOW = new Date("2026-11-12T10:00:00Z");
const LATER = new Date("2026-11-12T13:00:00Z"); // past a 2h lease

// Real git against a local origin: slow on Windows.
describe("the task store", { timeout: 30_000 }, () => {
  it("puts a task on the branch, where another machine picks it up", async () => {
    const { origin, a, b } = await twoMachines();
    await writeTask(a, "T-0001", '{"seq":1}\n');
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "T-0001: drafted",
      now: NOW,
    });
    // Only the task's files, on an orphan branch; the product branch is untouched.
    expect(
      git(origin, "ls-tree", "-r", "--name-only", TASKS_BRANCH).split("\n"),
    ).toEqual([
      "T-0001/card.yml",
      "T-0001/judge/round-1.json",
      "T-0001/lease.json",
      "T-0001/ledger.jsonl",
    ]);
    expect(git(origin, "rev-list", "--count", TASKS_BRANCH)).toBe("1");

    await pullTasks(b);
    expect(await read(b, "T-0001", "ledger.jsonl")).toBe('{"seq":1}\n');
    expect(await read(b, "T-0001", "judge", "round-1.json")).toBe("{}\n");
  });

  it("keeps a second machine off a task until the lease expires or is released", async () => {
    const { a, b } = await twoMachines();
    await writeTask(a, "T-0001", '{"seq":1}\n');
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: NOW,
    });

    // As the CLI does: pull, take the lease, then run the beat.
    await pullTasks(b);
    await expect(
      commitTask(b, "T-0001", { holder: "bob on b", message: "m", now: NOW }),
    ).rejects.toThrow(LeaseError);

    // Past the lease, the other machine takes the task over and carries on.
    await commitTask(b, "T-0001", {
      holder: "bob on b",
      message: "m",
      now: LATER,
    });
    await writeTask(b, "T-0001", '{"seq":1}\n{"seq":2}\n');
    await commitTask(b, "T-0001", {
      holder: "bob on b",
      message: "m",
      now: LATER,
    });
    expect((await taskLease(a, "T-0001"))?.holder).toBe("bob on b");
    await expect(
      commitTask(a, "T-0001", { holder: "ann on a", message: "m", now: LATER }),
    ).rejects.toThrow(/held by bob on b/);
    // Ann pulls Bob's entries rather than keeping her stale copy.
    await pullTasks(a);
    expect(await read(a, "T-0001", "ledger.jsonl")).toBe(
      '{"seq":1}\n{"seq":2}\n',
    );

    // A released task can be taken at once.
    await commitTask(b, "T-0001", {
      holder: "bob on b",
      message: "m",
      now: LATER,
      release: true,
    });
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: LATER,
    });
  });

  it("keeps this machine's copy of a task it holds when pulling", async () => {
    const { a } = await twoMachines();
    await writeTask(a, "T-0001", '{"seq":1}\n');
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: NOW,
    });
    await writeTask(a, "T-0001", '{"seq":1}\n{"seq":2}\n'); // not pushed yet
    await pullTasks(a);
    expect(await read(a, "T-0001", "ledger.jsonl")).toBe(
      '{"seq":1}\n{"seq":2}\n',
    );
  });

  it("never deletes a record no push has carried, even after its lease expired", async () => {
    const { origin, a } = await twoMachines();
    await writeTask(a, "T-0001", '{"seq":1}\n');
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: NOW,
    });
    // A beat writes more, and its push fails (origin unreachable).
    await writeTask(a, "T-0001", '{"seq":1}\n{"seq":2}\n');
    git(a, "remote", "set-url", "origin", join(origin, "gone"));
    await expect(
      commitTask(a, "T-0001", { holder: "ann on a", message: "m", now: NOW }),
    ).rejects.toThrow(StoreError);
    git(a, "remote", "set-url", "origin", origin);

    // Past the lease, a pull keeps the unpushed copy and says so…
    expect(await pullTasks(a)).toEqual({ kept: ["T-0001"] });
    expect(await read(a, "T-0001", "ledger.jsonl")).toBe(
      '{"seq":1}\n{"seq":2}\n',
    );
    // …and the next write carries it.
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: LATER,
    });
    expect(git(origin, "show", `${TASKS_BRANCH}:T-0001/ledger.jsonl`)).toBe(
      '{"seq":1}\n{"seq":2}',
    );
    expect(await pullTasks(a)).toEqual({ kept: [] });
  });

  it("won't let a kept copy overwrite what someone else pushed since", async () => {
    const { origin, a, b } = await twoMachines();
    await writeTask(a, "T-0001", '{"seq":1}\n');
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: NOW,
    });
    // Ann writes offline; past her lease, Bob takes over and pushes.
    await writeTask(a, "T-0001", '{"seq":1}\n{"ann":2}\n');
    await pullTasks(b);
    await commitTask(b, "T-0001", {
      holder: "bob on b",
      message: "m",
      now: LATER,
    });
    await writeTask(b, "T-0001", '{"seq":1}\n{"bob":2}\n');
    await commitTask(b, "T-0001", {
      holder: "bob on b",
      message: "m",
      now: LATER,
      release: true,
    });
    // Ann's copy is kept (it was never pushed), but can't replace Bob's.
    expect(await pullTasks(a)).toEqual({ kept: ["T-0001"] });
    await expect(
      commitTask(a, "T-0001", {
        holder: "ann on a",
        message: "m",
        now: new Date(LATER.getTime() + 60_000),
      }),
    ).rejects.toThrow(/isn't the branch's: bob on b has written it since/);
    expect(git(origin, "show", `${TASKS_BRANCH}:T-0001/ledger.jsonl`)).toBe(
      '{"seq":1}\n{"bob":2}',
    );
  });

  it("renews only the lease on a heartbeat", async () => {
    const { origin, a } = await twoMachines();
    await writeTask(a, "T-0001", '{"seq":1}\n');
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: NOW,
    });
    await writeTask(a, "T-0001", '{"seq":1}\n{"half-written'); // mid-beat
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      now: LATER,
      leaseOnly: true,
    });
    expect(git(origin, "show", `${TASKS_BRANCH}:T-0001/ledger.jsonl`)).toBe(
      '{"seq":1}',
    );
    expect(
      JSON.parse(git(origin, "show", `${TASKS_BRANCH}:T-0001/lease.json`))
        .expires,
    ).toBe("2026-11-12T15:00:00.000Z");
  });

  it("only puts tasks that exist on the branch", async () => {
    const { a } = await twoMachines();
    await expect(
      commitTask(a, "T-0099", { holder: "ann on a", message: "m" }),
    ).rejects.toThrow(/no task T-0099/);
    expect(git(a, "branch", "--list", TASKS_BRANCH)).toBe("");
  });

  it("gives two machines different ids, and refuses to reuse one", async () => {
    const { a, b } = await twoMachines();
    const first = await reserveTaskId(a, { holder: "ann on a", now: NOW });
    const second = await reserveTaskId(b, { holder: "bob on b", now: NOW });
    expect([first, second]).toEqual(["T-0001", "T-0002"]);
    await expect(
      commitTask(b, "T-0001", {
        holder: "bob on b",
        message: "m",
        now: LATER,
        create: true,
      }),
    ).rejects.toThrow(StoreError);
  });

  it("appends history rows once each, beside the tasks", async () => {
    const { origin, a, b } = await twoMachines();
    await writeTask(a, "T-0001", "{}\n");
    await writeTask(b, "T-0002", "{}\n");
    const row = (id: string, minutes = 1) =>
      JSON.stringify({ kind: "task", task: id, minutes });
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      history: [row("T-0001")],
    });
    await commitTask(b, "T-0002", {
      holder: "bob on b",
      message: "m",
      history: [row("T-0002")],
    });
    // A re-run (close resumed after a failure) doesn't add the row twice.
    await commitTask(a, "T-0001", {
      holder: "ann on a",
      message: "m",
      history: [row("T-0001", 2)],
    });
    expect(git(origin, "show", `${TASKS_BRANCH}:history.jsonl`)).toBe(
      `${row("T-0001")}\n${row("T-0002")}`,
    );
  });

  it("keeps the branch local in a repo with no origin", async () => {
    const repo = await tmp("factory-local-");
    git(repo, "init", "-b", "main");
    await writeTask(repo, "T-0001", "{}\n");
    await commitTask(repo, "T-0001", { holder: "ann on a", message: "m" });
    expect(git(repo, "ls-tree", "--name-only", TASKS_BRANCH)).toBe("T-0001");
    expect(await reserveTaskId(repo, { holder: "ann on a" })).toBe("T-0002");
  });
});
