// Personal state: the list of local repo folders the user has added. Lives in
// `app.getPath('userData')` (never the repo) per the plan's state split.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { app } from "electron";

import { type RepoEntry, RepoList } from "../../shared/ipc";

function storePath(): string {
  return join(app.getPath("userData"), "repos.json");
}

// Serialize read-modify-write mutations so two concurrent add/remove calls can't
// each read the old list and clobber the other's write. Reads don't need it.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  // Keep the chain alive even if a mutation rejects.
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function listRepos(): Promise<RepoEntry[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = RepoList.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function saveRepos(repos: RepoEntry[]): Promise<void> {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(repos, null, 2), "utf8");
}

/** Add a repo folder (idempotent by path); returns the updated, sorted list. */
export function addRepo(path: string): Promise<RepoEntry[]> {
  return withLock(async () => {
    const repos = await listRepos();
    if (!repos.some((r) => r.path === path)) {
      repos.push({ path, name: basename(path) });
      repos.sort((a, b) => a.name.localeCompare(b.name));
      await saveRepos(repos);
    }
    return repos;
  });
}

export function removeRepo(path: string): Promise<RepoEntry[]> {
  return withLock(async () => {
    const repos = (await listRepos()).filter((r) => r.path !== path);
    await saveRepos(repos);
    return repos;
  });
}
