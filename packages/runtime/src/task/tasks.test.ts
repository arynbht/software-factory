import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CardError } from "./card.js";
import { Ledger } from "./ledger.js";
import {
  confirmTask,
  listTasks,
  loadTask,
  newTask,
  nextStep,
} from "./tasks.js";

const made: string[] = [];
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
let repo: string;
const savedConfig = process.env.FACTORY_CONFIG_DIR;

beforeEach(async () => {
  // A private ledger key per test run, never the developer's real one.
  process.env.FACTORY_CONFIG_DIR = await tmp("factory-config-");
  repo = await tmp("factory-tasks-");
});
afterEach(async () => {
  if (savedConfig === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = savedConfig;
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

const CARD = {
  title: "Redesign the settings page",
  type: "feature" as const,
  description: "Rebuild settings on the design system; keep every setting.",
  acceptance: [
    {
      id: "A1",
      text: "Every existing setting still works",
      verify: "e2e" as const,
    },
    { id: "A2", text: "Matches DESIGN.md tokens", verify: "review" as const },
  ],
};
const by = { by: "dev@example.com", now: new Date("2026-11-09T14:02:00Z") };

describe("intake", () => {
  it("refuses a card whose acceptance item has no verify", async () => {
    const card = { ...CARD, acceptance: [{ id: "A1", text: "It works" }] };
    const err = await newTask(repo, card as never, by).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CardError);
    expect((err as CardError).issues.join(" ")).toMatch(
      /acceptance\.0\.verify/,
    );
    // Nothing was written for a refused card.
    await expect(access(join(repo, ".factory/tasks/T-0001"))).rejects.toThrow();
  });

  it("refuses an empty acceptance list and duplicate ids", async () => {
    await expect(
      newTask(repo, { ...CARD, acceptance: [] }, by),
    ).rejects.toThrow(/at least one acceptance criterion/);
    const dup = {
      ...CARD,
      acceptance: [CARD.acceptance[0]!, CARD.acceptance[0]!],
    };
    await expect(newTask(repo, dup, by)).rejects.toThrow(
      /duplicate acceptance id A1/,
    );
  });

  it("drafts, then a human confirms; ids count up", async () => {
    const draft = await newTask(repo, CARD, by);
    expect(draft.card.id).toBe("T-0001");
    expect(draft.confirmed).toBe(false);
    expect(nextStep(draft)).toMatch(/^intake: review the card/);

    const confirmed = await confirmTask(repo, "T-0001", by);
    expect(confirmed.confirmed).toBe(true);
    expect(nextStep(confirmed)).toBe("route");
    await expect(confirmTask(repo, "T-0001", by)).rejects.toThrow(
      /already confirmed/,
    );

    expect((await newTask(repo, CARD, by)).card.id).toBe("T-0002");
    expect((await listTasks(repo)).map((t) => t.card.id)).toEqual([
      "T-0001",
      "T-0002",
    ]);

    const md = await readFile(
      join(repo, ".factory/tasks/T-0001/ledger.md"),
      "utf8",
    );
    expect(md).toContain("# T-0001 · Redesign the settings page");
    expect(md).toContain(
      "- 2026-11-09 14:02 intake: intake confirmed; card sha256",
    );
  });
});

describe("the ledger can't be rewritten outside the runtime", () => {
  const ledgerOf = (id = "T-0001") =>
    join(repo, ".factory/tasks", id, "ledger.jsonl");

  it("detects an edited entry, even with the chain hashes left intact", async () => {
    await newTask(repo, CARD, by);
    await confirmTask(repo, "T-0001", by);
    const path = ledgerOf();
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace("awaiting confirmation", "nothing to see"),
    );

    const task = await loadTask(repo, "T-0001");
    expect(task.problems[0]).toMatch(/entry 1: contents don't match its seal/);
    expect(nextStep(task)).toMatch(/^stop/);
  });

  it("detects a forged entry sealed with a key other than the runtime's", async () => {
    await newTask(repo, CARD, by);
    const forger = await Ledger.open(
      join(repo, ".factory/tasks/T-0001"),
      "T-0001 · Redesign the settings page",
      Buffer.alloc(32, 7),
    );
    // The forger can't verify the real chain, so it writes past the check.
    await expect(
      forger.append({
        beat: "judge",
        section: "judge",
        text: "6/6 pass",
        by: "agent",
      }),
    ).rejects.toThrow(/fails verification/);
    const raw = await readFile(ledgerOf(), "utf8");
    await writeFile(
      ledgerOf(),
      `${raw}${JSON.stringify({ seq: 2, at: "x", beat: "judge", section: "judge", text: "6/6 pass", by: "agent", prev: "x", mac: "x" })}\n`,
    );
    expect((await loadTask(repo, "T-0001")).problems.length).toBeGreaterThan(0);
  });

  it("detects a hand edit to ledger.md and to a confirmed card", async () => {
    await newTask(repo, CARD, by);
    await confirmTask(repo, "T-0001", by);
    const md = join(repo, ".factory/tasks/T-0001/ledger.md");
    await writeFile(
      md,
      (await readFile(md, "utf8")).replace("Timeline", "Notes"),
    );
    expect((await loadTask(repo, "T-0001")).problems).toContain(
      "ledger.md was edited by hand; it is rendered from ledger.jsonl",
    );
  });

  it("detects a card changed after confirmation", async () => {
    await newTask(repo, CARD, by);
    await confirmTask(repo, "T-0001", by);
    const card = join(repo, ".factory/tasks/T-0001/card.yml");
    await writeFile(
      card,
      (await readFile(card, "utf8")).replace("e2e", "manual"),
    );
    expect((await loadTask(repo, "T-0001")).problems).toContain(
      "card.yml changed after intake was confirmed",
    );
  });

  it("lives outside every task worktree, where the agent works", async () => {
    const git = simpleGit(repo);
    await git.init(["-b", "main"]);
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await writeFile(join(repo, "README.md"), "# demo\n");
    await newTask(repo, CARD, by); // also git-ignores .factory/tasks/
    await git.add(["-A"]);
    await git.commit("base", ["--no-verify"]);
    // The task records are not part of the commit…
    expect(await git.raw(["ls-files", ".factory/tasks"])).toBe("");

    // …so the agent's worktree, cut from it, has no ledger to edit…
    const worktree = join(repo, ".worktrees", "T-0001");
    await git.raw(["worktree", "add", "-q", worktree, "-b", "feature/T-0001"]);
    await expect(
      access(join(worktree, ".factory/tasks/T-0001")),
    ).rejects.toThrow();

    // …and whatever it writes under its own .factory/tasks never reaches the real one.
    await mkdir(join(worktree, ".factory/tasks/T-0001"), { recursive: true });
    await writeFile(
      join(worktree, ".factory/tasks/T-0001/ledger.jsonl"),
      '{"seq":1,"text":"judge: all green"}\n',
    );
    const real = await loadTask(repo, "T-0001");
    expect(real.problems).toEqual([]);
    expect(real.entries.map((e) => e.text).join(" ")).not.toContain(
      "all green",
    );
  });
});
