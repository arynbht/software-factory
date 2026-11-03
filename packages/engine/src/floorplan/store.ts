// Persistence for the floor-plan model: `.factory/floorplan.json` is factory-
// managed state (ADR-0003), written atomically like state.json. Loading tolerates
// a missing or corrupt file (returns null) so the UI degrades to "run an audit".
// `isStale` compares the repo's current git HEAD to the model's recorded commit,
// so the shell's various refresh triggers (repo switch, after a fix, app close) can
// cheaply no-op when nothing has actually changed since the last scan.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runTool } from "../detectors/exec.js";
import { writeFileAtomic } from "../fs-atomic.js";
import type { RepositoryModel } from "./types.js";

function floorplanPath(repoPath: string): string {
  return resolve(repoPath, ".factory", "floorplan.json");
}

/** Load the persisted model, or null if absent / unreadable / malformed. */
export async function loadFloorPlan(
  repoPath: string,
): Promise<RepositoryModel | null> {
  let raw: string;
  try {
    raw = await readFile(floorplanPath(repoPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RepositoryModel>;
    // A light structural check — the full shape is re-validated with zod at the
    // desktop IPC boundary before the renderer draws it.
    if (parsed.version !== 1 || !Array.isArray(parsed.nodes)) return null;
    return parsed as RepositoryModel;
  } catch {
    return null;
  }
}

/** Write the model to `.factory/floorplan.json` (atomic, trailing newline). */
export async function saveFloorPlan(
  repoPath: string,
  model: RepositoryModel,
): Promise<void> {
  await writeFileAtomic(
    floorplanPath(repoPath),
    `${JSON.stringify(model, null, 2)}\n`,
  );
}

async function currentHead(repoPath: string): Promise<string | undefined> {
  try {
    const { exitCode, stdout } = await runTool(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
    );
    const head = stdout.trim();
    return exitCode === 0 && head ? head : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the persisted model is out of date for `repoPath`. Stale when there is
 * no model, when either HEAD is unknown (can't prove freshness), or when HEAD has
 * moved since the model was built. `head` is injectable for tests.
 */
export async function isStale(
  repoPath: string,
  model: RepositoryModel | null,
  head: (repoPath: string) => Promise<string | undefined> = currentHead,
): Promise<boolean> {
  if (!model) return true;
  const current = await head(repoPath);
  if (!current || !model.commit) return true;
  return current !== model.commit;
}
