// Installing always-scope skills into a repo: `.agents/skills/<name>/` is the
// canonical copy (Cursor and Codex read it), `.claude/skills/<name>` points at
// it. Installed skills are git-ignored — the lock travels, not the bodies.
import {
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";

export const AGENTS_SKILLS = ".agents/skills";
export const CLAUDE_SKILLS = ".claude/skills";

const BEGIN = "# factory skills (managed by `factory skills sync`)";
const END = "# end factory skills";

export async function installSkill(
  repoPath: string,
  name: string,
  from: string,
): Promise<void> {
  const target = join(repoPath, AGENTS_SKILLS, name);
  await rm(target, { recursive: true, force: true });
  await mkdir(join(repoPath, AGENTS_SKILLS), { recursive: true });
  await cp(from, target, { recursive: true });

  const link = join(repoPath, CLAUDE_SKILLS, name);
  await removeLink(link);
  await mkdir(join(repoPath, CLAUDE_SKILLS), { recursive: true });
  try {
    // A directory junction on Windows needs no admin rights; elsewhere a
    // relative symlink keeps the repo relocatable.
    if (process.platform === "win32") await symlink(target, link, "junction");
    else
      await symlink(
        relative(join(repoPath, CLAUDE_SKILLS), target),
        link,
        "dir",
      );
  } catch {
    await cp(target, link, { recursive: true });
  }
}

export async function uninstallSkill(
  repoPath: string,
  name: string,
): Promise<void> {
  await removeLink(join(repoPath, CLAUDE_SKILLS, name));
  await rm(join(repoPath, AGENTS_SKILLS, name), {
    recursive: true,
    force: true,
  });
}

async function removeLink(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    // A junction/symlink is removed as a link, never by recursing into its target.
    await rm(path, { recursive: !stat.isSymbolicLink(), force: true });
  } catch {
    // absent
  }
}

/** Keep installed skills and per-machine state out of git. */
export async function writeIgnores(
  repoPath: string,
  installed: readonly string[],
): Promise<void> {
  await ensureFile(join(repoPath, AGENTS_SKILLS, ".gitignore"), "*\n");
  await replaceBlock(
    join(repoPath, CLAUDE_SKILLS, ".gitignore"),
    installed.map((n) => `/${n}`),
  );
  await replaceBlock(join(repoPath, ".factory", ".gitignore"), [
    "skills.state.json",
  ]);
}

async function ensureFile(path: string, contents: string): Promise<void> {
  try {
    await readFile(path);
  } catch {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

async function replaceBlock(path: string, lines: string[]): Promise<void> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    // new file
  }
  const block =
    lines.length > 0 ? `${BEGIN}\n${lines.join("\n")}\n${END}\n` : "";
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  const next =
    start !== -1 && end !== -1
      ? `${text.slice(0, start)}${block}${text.slice(end + END.length).replace(/^\r?\n/, "")}`
      : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${block}`;
  if (next === text) return;
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, next, "utf8");
}
