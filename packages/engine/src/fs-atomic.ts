import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write a file atomically: write to a temp sibling then rename over the target
 * (rename is atomic on the same filesystem). Prevents a crash mid-write from
 * leaving a truncated/corrupt file, and makes concurrent writers last-wins on a
 * whole file rather than interleaving.
 */
export async function writeFileAtomic(
  path: string,
  contents: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.floor(performance.now())}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}
