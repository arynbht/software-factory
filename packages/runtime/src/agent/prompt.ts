// The sector agent's prompt (§7.1), assembled in a fixed order so the same
// task, assembly and base give the same prompt:
//   1. the contract (AGENTS.md at the base commit)
//   2. the task card
//   3. the assembly's skills, in order, bodies only, each verified against the lock
//   4. the repo slice from the context packer, capped by the budget
//   5. the operating rules
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildContext, packContext } from "@arynbht/factory-engine";
import { loadSkill, readLock } from "@arynbht/factory-registry";
import { simpleGit } from "simple-git";
import { stringify } from "yaml";

import { PROTECTED } from "../judge/protected.js";
import type { Assembly } from "../router/route.js";
import type { Card } from "../task/card.js";
import type { Isolation } from "./isolate.js";

export interface AssembledPrompt {
  system: string;
  prompt: string;
  /** Repo files the packer included, for the ledger. */
  files: string[];
  /** Skills whose bodies went in. */
  skills: string[];
}

/** SKILL.md without its frontmatter. */
function body(skillMd: string): string {
  return skillMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/** The contract docs, read from the base so a change can't rewrite its rules. */
const CONTRACT_DOCS = ["AGENTS.md", "CONSTRAINTS.md", "DESIGN.md"] as const;

/** The files a task's slice starts from: the README, touches, their tests. */
export function sliceGlobs(card: Card): string[] {
  const tests = card.touches.flatMap((t) =>
    /\*\*?$/.test(t) ? [] : [t.replace(/\.([a-z0-9]+)$/i, ".test.$1")],
  );
  const contract = new Set<string>(CONTRACT_DOCS);
  return ["README.md", ...card.touches, ...tests].filter(
    (g) => !contract.has(g),
  );
}

const SYSTEM = [
  "You are a factory sector agent working one task inside an isolated git worktree.",
  "Work only toward the task card's acceptance criteria; the judge verifies each by id, from a clean clone, after you finish.",
  "Do not commit, push or create branches: the runtime does that. Do not edit .factory/**, lint or CI config, or tests that already exist; add new tests instead.",
  "If the task needs something the operating rules say to ask about, stop and say so in your final message instead of doing it.",
  "Finish with a short plain-text summary of what you changed.",
].join("\n");

export async function assemblePrompt(options: {
  repoPath: string;
  card: Card;
  assembly: Assembly;
  isolation: Isolation;
  plan?: readonly string[] | undefined;
  /** What changed since the last round: a denial, or a failed proof. */
  answer?: string | undefined;
}): Promise<AssembledPrompt> {
  const { card, assembly, isolation } = options;
  const parts: string[] = [];

  // 1. The contract, from the base: the change can't rewrite its own rules.
  const git = simpleGit(options.repoPath);
  for (const doc of CONTRACT_DOCS) {
    const text = await git.show([`${isolation.base}:${doc}`]).catch(() => null);
    if (text?.trim()) parts.push(`# ${doc} (from the base)\n${text.trim()}`);
    else if (doc === "AGENTS.md")
      parts.push("# AGENTS.md\n(this repo has no AGENTS.md yet)");
  }

  // 2. The card.
  parts.push(`# Task card ${card.id}\n\`\`\`yaml\n${stringify(card)}\`\`\``);

  // 3. Skills, verified against the lock before a byte of them is used.
  const lock = await readLock(options.repoPath);
  const skills: string[] = [];
  for (const name of assembly.skills) {
    const entry = lock.skills.find((s) => s.name === name);
    if (!entry) throw new Error(`${name} is in the assembly but not the lock`);
    const { dir } = await loadSkill(options.repoPath, entry, {});
    const text = await readFile(join(dir, "SKILL.md"), "utf8");
    parts.push(`# Skill: ${name}\n${body(text)}`);
    skills.push(name);
  }

  // 4. The repo slice, from the worktree, secret-guarded and size-capped.
  const packed = await packContext(buildContext(isolation.worktree), {
    task: card.title,
    globs: sliceGlobs(card),
    maxBytes: assembly.budget.context_tokens * 4,
  });
  parts.push(packed.text);

  // 5. Operating rules.
  const stops = assembly.stop_and_ask.map((s) =>
    typeof s === "string"
      ? s.replace(/_/g, " ")
      : `touching ${s.touches.join(", ")}`,
  );
  parts.push(
    [
      "# Operating rules",
      `- Budget: at most ${assembly.budget.steps} plan steps.`,
      `- A person is asked, after your round, about: ${[...stops, "deleting or changing an existing test", "changing lint, CI or .factory files"].join("; ")}. You can't ask during the round. When the plan needs one of these, make the change: the runtime finds it in the diff and asks before anything ships. Only when a person must decide before you can start, change nothing and put the question in your reply's first line.`,
      `- Protected paths (never edit): ${[...PROTECTED.factoryState, ...PROTECTED.ciConfig, ...PROTECTED.lintConfig].join(", ")}.`,
      `- Proof: this task's proof is \`${assembly.proof}\`, produced by a tool after you finish; make sure it can be.`,
      `- Checks the judge runs: ${assembly.checks.join(", ")}.`,
      `- This worktree's port is ${isolation.port} and its database is ${isolation.database}; use nothing else.`,
      ...(options.plan?.length
        ? [
            "",
            "Your approved plan:",
            ...options.plan.map((s, i) => `${i + 1}. ${s}`),
          ]
        : []),
      ...(options.answer
        ? ["", `Since your last round: ${options.answer}`]
        : []),
    ].join("\n"),
  );

  return {
    system: SYSTEM,
    prompt: parts.join("\n\n"),
    files: packed.includedFiles,
    skills,
  };
}
