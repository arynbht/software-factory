// Personal state: the list of local repo folders the user has added. Lives in
// `app.getPath('userData')` (never the repo) per the plan's state split.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { app } from "electron";

import { type RepoEntry, RepoList } from "../../shared/ipc";

function storePath(): string {
  return join(app.getPath("userData"), "repos.json");
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
export async function addRepo(path: string): Promise<RepoEntry[]> {
  const repos = await listRepos();
  if (!repos.some((r) => r.path === path)) {
    repos.push({ path, name: basename(path) });
    repos.sort((a, b) => a.name.localeCompare(b.name));
    await saveRepos(repos);
  }
  return repos;
}

export async function removeRepo(path: string): Promise<RepoEntry[]> {
  const repos = (await listRepos()).filter((r) => r.path !== path);
  await saveRepos(repos);
  return repos;
}
