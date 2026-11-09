import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * The skill content hash. Fixed definition — it must never change, or every
 * lockfile breaks:
 *
 *   SHA-256 over the skill directory's regular files, sorted by their
 *   POSIX-style path relative to the directory (JavaScript string order), each
 *   contributing `path` + NUL + raw bytes, with no line-ending normalisation.
 *
 * Written as `sha256:<hex>`. The commit pin says where a skill came from; the
 * hash says it hasn't changed since. `.git` is not part of a skill.
 */
export async function hashSkillDir(dir: string): Promise<string> {
  const files = (await listFiles(dir))
    .map((abs) => ({ abs, rel: relative(dir, abs).split(sep).join("/") }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const { abs, rel } of files) {
    hash.update(rel, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(await readFile(abs));
  }
  return `sha256:${hash.digest("hex")}`;
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
