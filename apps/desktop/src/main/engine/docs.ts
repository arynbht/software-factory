// Docs adapter: list the repo's Markdown docs and read one. Uses the engine's
// contained glob/readFile (symlink-safe, repo-rooted), so the renderer can only
// read Markdown inside the repo. Electron-free.
import { basename } from "node:path";

import { buildContext } from "@arynbht/factory-engine";

import type { DocContent, DocEntry } from "../../shared/ipc";

const DOC_GLOBS = [
  "*.md",
  "docs/**/*.md",
  ".factory/**/*.md",
  ".github/**/*.md",
];

export async function listDocs(repoPath: string): Promise<DocEntry[]> {
  const ctx = buildContext(repoPath, {});
  const matches = await ctx.glob(DOC_GLOBS);
  const unique = [...new Set(matches)].sort((a, b) => a.localeCompare(b));
  return unique.map((path) => ({ path, name: path }));
}

export async function readDoc(
  repoPath: string,
  path: string,
): Promise<DocContent> {
  const ctx = buildContext(repoPath, {});
  const markdown = await ctx.readFile(path);
  if (markdown === null) {
    throw new Error(`document not found: ${basename(path)}`);
  }
  return { path, markdown };
}
