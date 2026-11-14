// Stop-and-ask (§7.2): what the agent's change did that a person has to agree
// to before the task moves on. Found from the committed diff, not the agent's
// account of it, so an agent can't talk its way past one.
import picomatch from "picomatch";
import { type SimpleGit, simpleGit } from "simple-git";

import { findProtected, protectedDetail } from "../judge/protected.js";
import { parseAddedLines, parseNameStatus } from "../judge/tier1.js";
import type { Assembly } from "../router/route.js";

export type StopTrigger =
  | "new_dependency"
  | "schema_change"
  | "protected_path"
  | "sensitive_path"
  | "budget_exhausted"
  | "no_change";

export interface Stop {
  trigger: StopTrigger;
  detail: string;
}

const DEPENDENCY_KEYS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Other ecosystems' manifests: any change to one is a dependency change. */
const OTHER_MANIFESTS = picomatch(
  [
    "**/requirements*.txt",
    "**/pyproject.toml",
    "**/Pipfile",
    "**/go.mod",
    "**/Cargo.toml",
    "**/Gemfile",
    "**/composer.json",
    "**/*.csproj",
    "**/pom.xml",
    "**/build.gradle*",
  ],
  { dot: true },
);

const SCHEMA = picomatch(
  ["**/migrations/**", "**/*.sql", "**/schema.prisma", "**/migrate/**"],
  { dot: true },
);

async function jsonAt(
  git: SimpleGit,
  rev: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await git.show([`${rev}:${path}`])) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** Package names a package.json gains between base and head. */
async function addedPackages(
  git: SimpleGit,
  base: string,
  head: string,
  path: string,
): Promise<string[]> {
  const before = (await jsonAt(git, base, path)) ?? {};
  const after = (await jsonAt(git, head, path)) ?? {};
  const names = (pkg: Record<string, unknown>) =>
    new Set(
      DEPENDENCY_KEYS.flatMap((k) =>
        Object.keys((pkg[k] as Record<string, unknown> | undefined) ?? {}),
      ),
    );
  const had = names(before);
  return [...names(after)].filter((n) => !had.has(n)).sort();
}

/**
 * Every stop the change from `base` to `head` (in `worktree`) triggers, given
 * the approved assembly. (The plan's budget is checked before building.)
 */
export async function findStops(
  worktree: string,
  base: string,
  head: string,
  assembly: Assembly,
): Promise<Stop[]> {
  const git = simpleGit(worktree);
  const diff = parseNameStatus(
    await git.raw(["diff", "--name-status", "-M", base, head]),
  );
  const stops: Stop[] = [];
  const asks = new Set<string>(
    assembly.stop_and_ask.flatMap((s) => (typeof s === "string" ? [s] : [])),
  );

  if (asks.has("new_dependency")) {
    for (const entry of diff) {
      if (entry.status === "D") continue;
      if (entry.path.endsWith("package.json")) {
        const added = await addedPackages(git, base, head, entry.path);
        if (added.length > 0)
          stops.push({
            trigger: "new_dependency",
            detail: `${entry.path} adds ${added.join(", ")}`,
          });
      } else if (OTHER_MANIFESTS(entry.path)) {
        stops.push({
          trigger: "new_dependency",
          detail: `${entry.path} changed`,
        });
      }
    }
  }

  if (asks.has("schema_change")) {
    const schema = diff.filter((e) => SCHEMA(e.path)).map((e) => e.path);
    if (schema.length > 0)
      stops.push({
        trigger: "schema_change",
        detail: `touches ${schema.join(", ")}`,
      });
  }

  for (const ask of assembly.stop_and_ask) {
    if (typeof ask === "string") continue;
    const isMatch = picomatch(ask.touches, { dot: true });
    const hit = diff.filter((e) => isMatch(e.path)).map((e) => e.path);
    if (hit.length > 0)
      stops.push({
        trigger: "sensitive_path",
        detail: `touches ${hit.join(", ")}`,
      });
  }

  const added = parseAddedLines(
    await git.raw(["diff", "-U0", "--no-color", base, head]),
  );
  // Scripts are the commands the checks run, in any package of a workspace.
  const scripts = async (rev: string, path: string) =>
    JSON.stringify((await jsonAt(git, rev, path))?.scripts ?? null);
  let scriptsChanged = false;
  for (const entry of diff) {
    if (!entry.path.endsWith("package.json")) continue;
    const before = await scripts(base, entry.oldPath ?? entry.path);
    if (before !== (await scripts(head, entry.path))) scriptsChanged = true;
  }
  for (const f of findProtected(diff, added, scriptsChanged)) {
    stops.push({ trigger: "protected_path", detail: protectedDetail(f) });
  }
  return stops;
}
