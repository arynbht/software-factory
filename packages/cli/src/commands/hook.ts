import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { runTool } from "@arynbht/factory-engine";
import { BEATS, listTasks, nextStep } from "@arynbht/factory-runtime";

import { GUARD_COMMAND, GUARD_MATCHER, isFactoryHook } from "./init-files.js";

// Claude Code hooks that `factory init` installs in `.claude/settings.json`
// (§10). They run in the person's interactive session, not the sector agent's
// (which runs with no repo hooks at all).

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false);

async function git(args: string[], cwd: string): Promise<string | null> {
  const res = await runTool("git", args, cwd).catch(() => null);
  return res && res.exitCode === 0 ? res.stdout.trim() : null;
}

/** The PreToolUse input fields the guard reads. */
export interface HookInput {
  cwd?: string;
  tool_input?: {
    file_path?: string;
    notebook_path?: string;
    /** Bash's command line. */
    command?: string;
  };
}

/** The top of the factory repo `dir` is in, or null outside one. */
async function factoryTop(dir: string): Promise<string | null> {
  const top = await git(["rev-parse", "--show-toplevel"], dir);
  return top && (await exists(join(top, ".factory", "profile.yml")))
    ? top
    : null;
}

/**
 * Why writing `abs` must not happen, or null when it may: anything under
 * `.factory/**` (the runtime's state), and anything in the primary checkout
 * while it's on the default branch (work happens in a task's worktree).
 * Only in repos with a factory profile.
 */
async function pathReason(abs: string): Promise<string | null> {
  // The file may be new: ask git about the nearest directory that exists.
  let dir = dirname(abs);
  while (!(await exists(dir))) {
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  const top = await factoryTop(dir);
  if (!top) return null;

  // git reports the physical path; canonicalise the file's side the same way,
  // or a symlinked checkout (macOS /var → /private/var) slips past the check.
  const physical = join(await realpath(dir), relative(dir, abs));
  const rel = relative(await realpath(top), physical)
    .split(sep)
    .join("/");
  if (rel === ".factory" || rel.startsWith(".factory/"))
    return `${rel} is the factory's state: the runtime writes it, and a person edits it by hand. Use the factory CLI (\`factory task …\`, \`factory waive\`, \`factory profile set\`) instead.`;

  // A task's worktree is a linked worktree: its git dir isn't the common one.
  const gitDir = await git(["rev-parse", "--absolute-git-dir"], dir);
  const common = await git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    dir,
  );
  if (gitDir && common && resolve(gitDir) !== resolve(common)) return null;

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const originHead = await git(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    dir,
  );
  const defaults = originHead
    ? [originHead.replace(/^refs\/remotes\/origin\//, "")]
    : ["main", "master"];
  if (branch && defaults.includes(branch))
    return `this is the primary checkout on ${branch}. Changes go through a task: start one with /factory (it works in .worktrees/<id> and opens a PR), or switch to a branch for a change you're making by hand.`;
  return null;
}

/** One simple command of a shell line: its words, and where `>` sends output. */
export interface ShellCommand {
  words: string[];
  redirects: string[];
}

/**
 * Split a shell line into simple commands, well enough to see what they
 * write: quotes and escapes, `;` `&&` `||` `|` `&` and newlines, subshells,
 * `>`/`>>`/`&>` targets (fd duplication like `2>&1` isn't a target), input
 * redirects, comments and heredoc bodies. A heuristic, not a shell (§5.2).
 */
export function parseShell(line: string): ShellCommand[] {
  const out: ShellCommand[] = [];
  let cur: ShellCommand = { words: [], redirects: [] };
  let word = "";
  let inWord = false;
  let quote: string | null = null;
  let next: "word" | "redirect" | "skip" = "word";
  const heredocs: string[] = [];
  let heredocNext = false;

  const endWord = () => {
    if (!inWord) return;
    if (heredocNext) heredocs.push(word);
    else if (next === "redirect") cur.redirects.push(word);
    else if (next === "word") cur.words.push(word);
    heredocNext = false;
    next = "word";
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    next = "word";
    if (cur.words.length > 0 || cur.redirects.length > 0) out.push(cur);
    cur = { words: [], redirects: [] };
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      // In double quotes a backslash escapes only these; elsewhere it's literal.
      else if (
        c === "\\" &&
        quote === '"' &&
        '$`"\\\n'.includes(line[i + 1] ?? "x")
      )
        word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\") {
      if (i + 1 < line.length) word += line[++i];
      inWord = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === "#" && !inWord) {
      while (i + 1 < line.length && line[i + 1] !== "\n") i++;
    } else if (c === "\n") {
      endCommand();
      // A heredoc's body is data, not commands: skip to its delimiter.
      for (const delim of heredocs.splice(0)) {
        while (i < line.length) {
          const end = line.indexOf("\n", i + 1);
          const body = line.slice(i + 1, end === -1 ? line.length : end);
          i = end === -1 ? line.length : end;
          if (body.trim() === delim) break;
        }
      }
    } else if (c === "&" && line[i + 1] === ">") {
      endWord();
      i += line[i + 2] === ">" ? 2 : 1;
      next = "redirect";
    } else if (c === ">") {
      // `2>file`: the digits are the fd, not a word.
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else endWord();
      if (line[i + 1] === ">" || line[i + 1] === "|") i++;
      if (line[i + 1] === "&") {
        i++;
        while (/[0-9-]/.test(line[i + 1] ?? "")) i++;
        continue;
      }
      next = "redirect";
    } else if (c === "<") {
      endWord();
      if (line[i + 1] === "<") {
        i++;
        if (line[i + 1] === "<") {
          i++; // a here-string: its word is data
          next = "skip";
        } else {
          if (line[i + 1] === "-") i++;
          heredocNext = true;
        }
      } else next = "skip";
    } else if (";|&()`".includes(c)) {
      endCommand();
      if ((c === "|" || c === "&") && line[i + 1] === c) i++;
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return out;
}

/** Arguments that aren't options, `--` ending the options. */
function operands(args: string[], takesValue: string[] = []): string[] {
  const out: string[] = [];
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (options && a === "--") options = false;
    else if (options && takesValue.includes(a)) i++;
    else if (!options || !a.startsWith("-") || a === "-") out.push(a);
  }
  return out;
}

/** The paths a command writes, removes or moves, as far as its words show. */
function writeTargets(name: string, args: string[]): string[] {
  switch (name) {
    case "rm":
    case "rmdir":
    case "unlink":
    case "touch":
    case "tee":
    case "mkdir":
    case "mv":
      return operands(args);
    case "truncate":
      return operands(args, ["-s", "-r"]);
    case "cp":
    case "ln":
    case "install":
      return operands(args, ["-t", "-S"]).slice(-1);
    case "sed":
    case "perl": {
      const inPlace = args.some(
        (a) =>
          /^-[a-zA-Z]*i/.test(a) ||
          a === "--in-place" ||
          a.startsWith("--in-place="),
      );
      if (!inPlace) return [];
      const scripted = args.some((a) =>
        ["-e", "-f", "--expression", "--file"].includes(a),
      );
      const files = operands(args, ["-e", "-f", "--expression", "--file"]);
      return scripted ? files : files.slice(1);
    }
    case "dd":
      return args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
    default:
      return [];
  }
}

/** A word as a path from `cwd`, or null when it names something only a shell knows. */
function wordPath(word: string, cwd: string): string | null {
  if (/[$`]/.test(word) || word === "/dev/null" || /^nul$/i.test(word))
    return null;
  let path = word.startsWith("~") ? homedir() + word.slice(1) : word;
  // A glob writes inside the directory it starts in: check that directory.
  const glob = path.search(/[*?[]/);
  if (glob !== -1) path = path.slice(0, path.lastIndexOf("/", glob) + 1) || ".";
  // Git Bash on Windows spells C:\x as /c/x.
  if (process.platform === "win32")
    path = path.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * Why a git command must not run here, or null: the ones that destroy work
 * or history (force push, remote delete, hard reset, clean, force-deleting a
 * branch), in a factory repo. A person runs those themselves (§5.2).
 */
async function gitReason(args: string[], cwd: string): Promise<string | null> {
  let dir = cwd;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "-C") dir = resolve(dir, args[++i] ?? ".");
    else if (a === "-c") i++;
    else if (!a.startsWith("-")) break;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  const has = (...flags: string[]) => rest.some((a) => flags.includes(a));
  const short = (letter: string) =>
    rest.some((a) => new RegExp(`^-[a-zA-Z]*${letter}`).test(a));
  let what: string | null = null;
  if (sub === "push") {
    if (
      short("f") ||
      has("--force", "--mirror", "--delete", "--prune") ||
      rest.some(
        (a) =>
          a.startsWith("--force-with-lease") ||
          a.startsWith("+") ||
          a.startsWith(":"),
      ) ||
      short("d")
    )
      what =
        "a force push or a remote delete rewrites history other people, PRs and the ledger point at";
  } else if (sub === "reset" && has("--hard")) {
    what = "`git reset --hard` throws away uncommitted work";
  } else if (
    sub === "clean" &&
    (short("f") || has("--force")) &&
    !(short("n") || has("--dry-run"))
  ) {
    what = "`git clean` deletes untracked files for good";
  } else if (
    sub === "branch" &&
    (short("D") ||
      ((short("d") || has("--delete")) && (short("f") || has("--force"))))
  ) {
    what = "force-deleting a branch can lose commits nothing else points at";
  }
  if (!what || !(await factoryTop(dir))) return null;
  return `${what}. In a factory repo Claude doesn't run it; if you mean it, run it yourself in a terminal.`;
}

/**
 * Why a Bash command must not run, or null: a write (redirect, `tee`, `cp`,
 * `mv`, `rm`, `sed -i`, …) to anything the edit guard protects, or a git
 * command that destroys work. Heuristic (§5.2): it reads the words, so a
 * script that writes by itself isn't seen. The judge's protected-path check
 * is the backstop.
 */
export async function bashReason(
  command: string,
  cwd: string,
): Promise<string | null> {
  let dir = cwd;
  for (const { words, redirects } of parseShell(command)) {
    // Leading `VAR=value` assignments, and wrappers that run the real command.
    let k = 0;
    while (
      k < words.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k] as string)
    )
      k++;
    while (
      ["sudo", "command", "exec", "time", "nohup", "env"].includes(
        words[k] ?? "",
      )
    )
      k++;
    const name = (words[k] ?? "").split("/").pop() ?? "";
    const args = words.slice(k + 1);
    if (name === "cd") {
      const to = wordPath(args[0] ?? "~", dir);
      if (to) dir = to;
      continue;
    }
    if (name === "git") {
      const reason = await gitReason(args, dir);
      if (reason) return reason;
    }
    for (const target of [...redirects, ...writeTargets(name, args)]) {
      const abs = wordPath(target, dir);
      const reason = abs ? await pathReason(abs) : null;
      if (reason)
        return `this command writes ${target}, and ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
    }
  }
  return null;
}

/** Why a tool call must not happen, or null when it may. */
export async function guardReason(input: HookInput): Promise<string | null> {
  const cwd = input.cwd ?? process.cwd();
  const command = input.tool_input?.command;
  if (typeof command === "string") return bashReason(command, cwd);
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!target) return null;
  return pathReason(isAbsolute(target) ? target : resolve(cwd, target));
}

/** `factory hook guard`: a PreToolUse hook; exit 2 blocks the call and tells Claude why. */
export async function runHookGuard(): Promise<number> {
  let input: HookInput = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
  } catch {
    return 0; // not a hook payload: nothing to guard
  }
  const reason = await guardReason(input);
  if (!reason) return 0;
  process.stderr.write(`factory: ${reason}\n`);
  return 2;
}

/**
 * Is the guard live in `root` (§12)? The current guard hook must be in
 * `.claude/settings.json` (Claude Code reads no other file of ours) with a
 * matcher covering edits and Bash, and it must refuse a `.factory/**` edit.
 * Run in-process: whether `factory` is on PATH is `factory doctor`'s check.
 */
export async function guardSelfTest(
  root: string,
): Promise<{ ok: boolean; detail: string }> {
  const text = await readFile(
    join(root, ".claude", "settings.json"),
    "utf8",
  ).catch(() => null);
  let groups: { matcher?: unknown; hooks?: { command?: unknown }[] }[] = [];
  try {
    const settings = JSON.parse(text ?? "{}") as {
      hooks?: { PreToolUse?: typeof groups };
    };
    groups = Array.isArray(settings.hooks?.PreToolUse)
      ? settings.hooks.PreToolUse
      : [];
  } catch {
    return {
      ok: false,
      detail: ".claude/settings.json doesn't parse, so no hook runs",
    };
  }
  const ours = groups.filter((g) =>
    (Array.isArray(g?.hooks) ? g.hooks : []).some((h) =>
      isFactoryHook(h?.command),
    ),
  );
  if (ours.length === 0)
    return {
      ok: false,
      detail: text
        ? ".claude/settings.json has no factory guard hook: run `factory init` to merge it in"
        : "no .claude/settings.json: run `factory init`",
    };
  const current = ours.some(
    (g) =>
      g.matcher === GUARD_MATCHER &&
      g.hooks?.some((h) => h?.command === GUARD_COMMAND),
  );
  if (!current)
    return {
      ok: false,
      detail:
        "the guard hook is from an older factory (it misses Bash, or fails open): run `factory init` to update it",
    };
  const blocks = await guardReason({
    cwd: root,
    tool_input: { file_path: join(root, ".factory", "profile.yml") },
  });
  return blocks
    ? {
        ok: true,
        detail: "the guard hook is installed and refuses a .factory/** edit",
      }
    : { ok: false, detail: "the guard let a .factory/** edit through" };
}

/** What a session in this repo starts with: the guard's state, the contract in brief, and open tasks. */
export async function sessionStartText(root: string): Promise<string> {
  const guard = await guardSelfTest(root);
  const lines = [
    // First line, so a dead guard can't go unnoticed (§12).
    guard.ok
      ? "factory guard: on."
      : `factory guard: OFF. ${guard.detail}. Until it's fixed, nothing stops edits to .factory/** or to this checkout on the default branch.`,
    "This repo runs on the factory (see AGENTS.md).",
    "Start every task with /factory. The work happens in .worktrees/<id>, never in this checkout on the default branch.",
    `Beats: sync → ${BEATS.join(" → ")}. A person confirms the card, approves the route, answers stop-and-ask questions, and merges; the factory never merges.`,
  ];
  const agents = await readFile(join(root, "AGENTS.md"), "utf8").catch(
    () => null,
  );
  if (!agents) lines.push("(AGENTS.md is missing: run `factory init`.)");
  const open = await listTasks(root)
    .then((tasks) => tasks.filter((t) => nextStep(t) !== "done"))
    .catch(() => []);
  if (open.length > 0) {
    lines.push("Open tasks:");
    for (const t of open)
      lines.push(`- ${t.card.id} ${t.card.title}: next ${nextStep(t)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** `factory hook session-start`: printed into the session's context. */
export async function runHookSessionStart(path: string): Promise<number> {
  process.stdout.write(await sessionStartText(resolve(path)));
  return 0;
}
