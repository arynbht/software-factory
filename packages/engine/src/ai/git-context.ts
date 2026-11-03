// Git context for the `changelog` AI task: the conventional-commit subjects/bodies
// since the last release tag, plus the tag list, so the model can draft release
// notes. This is the one task whose input isn't repo files — it's the git history —
// so it's gathered here and only for that task (see generate.ts), never bloating the
// context of the other tasks.
//
// The git runner is injected (defaulting to simple-git over the repo path) so the
// assembly is pure and testable without a real repository, matching the
// fetch/runner injection style used elsewhere in the engine (claude-cli, device
// flow).

import { simpleGit } from "simple-git";

import type { AuditContext } from "../context.js";

/** A commit on the range since the last tag. */
export interface GitCommit {
  hash: string;
  subject: string;
  body: string;
}

/**
 * The minimal git surface the changelog context needs. Injected so tests supply a
 * fake; the default is backed by simple-git over the repo path.
 */
export interface GitRunner {
  /** The most recent tag reachable from HEAD, or null if the repo has no tags. */
  lastTag(): Promise<string | null>;
  /** All tags, newest first (best-effort ordering). */
  tags(): Promise<string[]>;
  /** Commits in `<range>` (e.g. `v1.2.0..HEAD`), newest first. */
  log(range: string): Promise<GitCommit[]>;
}

export interface GitChangelogContext {
  /** The tag the range starts after, or null when there's no prior release. */
  lastTag: string | null;
  /** Commits since `lastTag` (or the whole history when there's no tag). */
  commits: GitCommit[];
  /** Known tags, newest first. */
  tags: string[];
}

/** A simple-git–backed runner over the given repo path. */
export function simpleGitRunner(repoPath: string): GitRunner {
  const git = simpleGit(repoPath);
  return {
    async lastTag() {
      try {
        const tag = await git.raw(["describe", "--tags", "--abbrev=0", "HEAD"]);
        const trimmed = tag.trim();
        return trimmed === "" ? null : trimmed;
      } catch {
        // No tags reachable from HEAD (`describe` exits non-zero).
        return null;
      }
    },
    async tags() {
      try {
        const result = await git.tags(["--sort=-creatordate"]);
        return result.all;
      } catch {
        return [];
      }
    },
    async log(range) {
      // A unit-separator between fields and a record-separator between commits so
      // multi-line bodies survive parsing intact.
      const US = "\x1f";
      const RS = "\x1e";
      const format = ["%H", "%s", "%b"].join(US) + RS;
      let raw: string;
      try {
        raw = await git.raw(["log", `--format=${format}`, range]);
      } catch {
        return [];
      }
      return raw
        .split(RS)
        .map((rec) => rec.replace(/^\n+/, ""))
        .filter((rec) => rec.trim() !== "")
        .map((rec) => {
          const [hash = "", subject = "", body = ""] = rec.split(US);
          return {
            hash: hash.trim(),
            subject: subject.trim(),
            body: body.trim(),
          };
        });
    },
  };
}

/**
 * Gather the commits since the last tag and the tag list. When the repo has a
 * prior tag, the range is `<lastTag>..HEAD`; otherwise it's the full history. A
 * runner failure degrades to an empty context rather than failing the task — the
 * model still drafts from whatever it's given.
 */
export async function gatherGitChangelogContext(
  runner: GitRunner,
): Promise<GitChangelogContext> {
  const lastTag = await runner.lastTag();
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const [commits, tags] = await Promise.all([runner.log(range), runner.tags()]);
  return { lastTag, commits, tags };
}

/** Render the gathered git context as a Markdown section for the packed prompt. */
export function renderGitChangelogSection(ctx: GitChangelogContext): string {
  const lines: string[] = ["## Git history"];
  lines.push(
    ctx.lastTag
      ? `Commits since the last tag \`${ctx.lastTag}\`:`
      : "No prior release tag; commits across the full history:",
  );

  if (ctx.commits.length === 0) {
    lines.push("(no commits in range)");
  } else {
    for (const c of ctx.commits) {
      const short = c.hash.slice(0, 8);
      lines.push(`- ${short} ${c.subject}`);
      if (c.body) {
        for (const bodyLine of c.body.split("\n")) {
          if (bodyLine.trim() !== "") lines.push(`  ${bodyLine.trim()}`);
        }
      }
    }
  }

  lines.push("", "### Tags");
  lines.push(ctx.tags.length > 0 ? ctx.tags.join(", ") : "(no tags)");

  return lines.join("\n");
}

/**
 * The convenience entry point used by the generator: gather and render the git
 * changelog context for a repo. The runner defaults to simple-git over the audit
 * context's repo path, but tests inject a fake runner.
 */
export async function gitChangelogSection(
  ctx: AuditContext,
  runner: GitRunner = simpleGitRunner(ctx.repoPath),
): Promise<string> {
  const gathered = await gatherGitChangelogContext(runner);
  return renderGitChangelogSection(gathered);
}
