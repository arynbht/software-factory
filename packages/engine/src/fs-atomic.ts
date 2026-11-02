import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Write a file atomically: write to a temp sibling then rename over the target
 * (rename is atomic on the same filesystem). Prevents a crash mid-write from
 * leaving a truncated/corrupt file, and makes concurrent writers last-wins on a
 * whole file rather than interleaving.
 *
 * The temp name uses random bytes (not pid+time) so two concurrent writers in the
 * same process can't collide on the same temp path — and so the name isn't
 * predictable to a local attacker racing a symlink. On Windows, `rename` over an
 * existing target can fail transiently with EPERM/EACCES when another rename (or a
 * virus scanner) briefly holds the target, so the rename is retried with backoff.
 */
export async function writeFileAtomic(
  path: string,
  contents: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tmp, contents, "utf8");
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, path);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if ((code === "EPERM" || code === "EACCES") && attempt < 10) {
          await sleep(10 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    // Don't leave the temp file behind if the rename ultimately failed.
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
