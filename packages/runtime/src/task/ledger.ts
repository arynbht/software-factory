// The task ledger: the runtime's append-only record of a task, and the point a
// restarted session resumes from.
//
//   .factory/tasks/<id>/ledger.jsonl   the record: one entry per line, each
//                                      chained to the last by an HMAC keyed
//                                      with a per-machine secret
//   .factory/tasks/<id>/ledger.md      a human view rendered from it
//
// It lives in the primary checkout (git-ignored, so never inside a task's
// worktree), and the key lives outside every repo. An agent that edits an
// entry can't recompute the chain without the key, so `verify` catches it; a
// hand edit to ledger.md is caught by comparing it with a fresh render.
import { createHmac, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const BEATS = [
  "intake",
  "route",
  "isolate",
  "build",
  "prove",
  "judge",
  "ship",
  "close",
] as const;
export type Beat = (typeof BEATS)[number];

/** Where an entry is shown in ledger.md (§6.2). */
export const SECTIONS = [
  "timeline",
  "plan",
  "decision",
  "stop",
  "proof",
  "judge",
  "outcome",
] as const;
export type Section = (typeof SECTIONS)[number];

export interface LedgerEntry {
  seq: number;
  at: string;
  beat: Beat;
  section: Section;
  text: string;
  by: string;
  prev: string;
  mac: string;
}

const GENESIS = "genesis";

/** The per-machine ledger key, created on first use (outside every repo). */
export async function ledgerKey(): Promise<Buffer> {
  const dir =
    process.env.FACTORY_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "factory");
  const path = join(dir, "ledger.key");
  try {
    return Buffer.from((await readFile(path, "utf8")).trim(), "hex");
  } catch {
    const key = randomBytes(32);
    await mkdir(dir, { recursive: true });
    await writeFile(path, `${key.toString("hex")}\n`, {
      mode: 0o600,
      flag: "wx",
    }).catch(async () => undefined);
    // Another process may have won the race; use whatever is on disk.
    return Buffer.from((await readFile(path, "utf8")).trim(), "hex");
  }
}

function mac(key: Buffer, entry: Omit<LedgerEntry, "mac">): string {
  const body = JSON.stringify([
    entry.seq,
    entry.at,
    entry.beat,
    entry.section,
    entry.text,
    entry.by,
    entry.prev,
  ]);
  return createHmac("sha256", key).update(body).digest("hex");
}

export class Ledger {
  private constructor(
    readonly dir: string,
    readonly title: string,
    private readonly key: Buffer,
  ) {}

  /** The ledger in `dir` (a task directory). */
  static async open(dir: string, title: string, key?: Buffer): Promise<Ledger> {
    return new Ledger(dir, title, key ?? (await ledgerKey()));
  }

  get jsonlPath(): string {
    return join(this.dir, "ledger.jsonl");
  }
  get mdPath(): string {
    return join(this.dir, "ledger.md");
  }

  async entries(): Promise<LedgerEntry[]> {
    let text = "";
    try {
      text = await readFile(this.jsonlPath, "utf8");
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LedgerEntry);
  }

  /** Append one entry, chained to the last, and re-render ledger.md. */
  async append(entry: {
    beat: Beat;
    section: Section;
    text: string;
    by: string;
    at?: Date | undefined;
  }): Promise<LedgerEntry> {
    const check = await this.verify();
    if (!check.ok) {
      throw new LedgerError(
        `refusing to append to a ledger that fails verification:\n${check.problems.map((p) => `  - ${p}`).join("\n")}`,
      );
    }
    const all = await this.entries();
    const last = all[all.length - 1];
    const base = {
      seq: (last?.seq ?? 0) + 1,
      at: (entry.at ?? new Date()).toISOString(),
      beat: entry.beat,
      section: entry.section,
      text: entry.text.replace(/\r?\n/g, " ").trim(),
      by: entry.by,
      prev: last?.mac ?? GENESIS,
    };
    const full: LedgerEntry = { ...base, mac: mac(this.key, base) };
    await mkdir(dirname(this.jsonlPath), { recursive: true });
    await appendFile(this.jsonlPath, `${JSON.stringify(full)}\n`, "utf8");
    await writeFile(this.mdPath, render(this.title, [...all, full]), "utf8");
    return full;
  }

  /**
   * Check the chain: every entry's MAC, its link to the one before, and that
   * ledger.md still matches a fresh render. Problems name the first bad entry.
   */
  async verify(): Promise<{ ok: boolean; problems: string[] }> {
    const problems: string[] = [];
    let all: LedgerEntry[];
    try {
      all = await this.entries();
    } catch {
      return { ok: false, problems: ["ledger.jsonl is not valid JSON lines"] };
    }
    let prev = GENESIS;
    for (const [i, e] of all.entries()) {
      if (e.seq !== i + 1)
        problems.push(`entry ${i + 1}: out of sequence (seq ${e.seq})`);
      if (e.prev !== prev)
        problems.push(`entry ${e.seq}: doesn't follow the entry before it`);
      const { mac: stored, ...rest } = e;
      if (mac(this.key, rest) !== stored) {
        problems.push(
          `entry ${e.seq}: contents don't match its seal (edited after it was written)`,
        );
      }
      prev = stored;
      if (problems.length > 0) break;
    }
    if (problems.length === 0 && all.length > 0) {
      let md = "";
      try {
        md = await readFile(this.mdPath, "utf8");
      } catch {
        // missing view: re-rendered on the next append
      }
      if (md && md !== render(this.title, all)) {
        problems.push(
          "ledger.md was edited by hand; it is rendered from ledger.jsonl",
        );
      }
    }
    return { ok: problems.length === 0, problems };
  }
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const HEADINGS: Record<Exclude<Section, "timeline">, string> = {
  plan: "Plan",
  decision: "Decisions",
  stop: "Stop-and-ask",
  proof: "Proof",
  judge: "Judge",
  outcome: "Outcome",
};

/** ledger.md, in the §6.2 layout: the timeline, then each section that has entries. */
export function render(title: string, entries: readonly LedgerEntry[]): string {
  const time = (e: LedgerEntry) => e.at.slice(0, 16).replace("T", " ");
  const lines = [
    `# ${title}`,
    "",
    "<!-- Written by the factory runtime from ledger.jsonl. Don't edit: changes are detected. -->",
    "",
    "## Timeline",
    "",
    ...entries
      .filter((e) => e.section === "timeline")
      .map((e) => `- ${time(e)} ${e.beat}: ${e.text} (${e.by})`),
  ];
  for (const [section, heading] of Object.entries(HEADINGS)) {
    const items = entries.filter((e) => e.section === section);
    if (items.length === 0) continue;
    lines.push(
      "",
      `## ${heading}`,
      "",
      ...items.map((e) => `- ${time(e)} ${e.text}`),
    );
  }
  return `${lines.join("\n")}\n`;
}
