import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { loadBundledCatalog, SEVERITIES } from "@arynbht/factory-catalog";
import {
  buildContext,
  evaluateControls,
  EvidenceError,
  ProfileError,
  resolveToken,
  WaiverError,
} from "@arynbht/factory-engine";
import { parse as parseYaml } from "yaml";

import { summarize } from "../report.js";

export interface MultiFlags {
  all?: boolean;
  repos?: string;
  json?: boolean;
  token?: string;
  color?: boolean;
}

export interface RunMultiOptions {
  now?: Date | undefined;
  token?: string | null | undefined;
}

interface RepoRow {
  repo: string;
  ok: boolean;
  error?: string;
  pass?: number;
  fail?: number;
  needsEvidence?: number;
  total?: number;
  criticalFail?: boolean;
}

function defaultReposFile(): string {
  return resolve(homedir(), ".config", "factory", "repos.yml");
}

/** Parse a repos list file: a YAML list of paths (or `{ path }` objects). */
function parseRepos(raw: string): string[] {
  const parsed = parseYaml(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((e) =>
      typeof e === "string"
        ? e
        : e &&
            typeof e === "object" &&
            typeof (e as { path?: unknown }).path === "string"
          ? (e as { path: string }).path
          : null,
    )
    .filter((p): p is string => !!p);
}

/** `factory audit --all` — audit every repo in the list and print one table. */
export async function runAuditAll(
  flags: MultiFlags,
  options: RunMultiOptions = {},
): Promise<number> {
  const file = flags.repos ? resolve(flags.repos) : defaultReposFile();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    console.error(
      `factory audit --all: no repo list at ${file}. Create it (a YAML list of repo paths) or pass --repos <file>.`,
    );
    return 1;
  }
  const repos = parseRepos(raw);
  if (repos.length === 0) {
    console.error(`factory audit --all: ${file} has no repo paths.`);
    return 1;
  }

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)).`);
    return 1;
  }
  const token =
    options.token === null
      ? undefined
      : (options.token ?? resolveToken(flags.token));

  const rows: RepoRow[] = [];
  for (const repoPath of repos) {
    const root = resolve(repoPath);
    try {
      if (!(await stat(root)).isDirectory()) {
        rows.push({ repo: repoPath, ok: false, error: "not a directory" });
        continue;
      }
      const ctx = buildContext(root, { token, now: options.now });
      const profile = await ctx.profile();
      const waivers = await ctx.waivers();
      const floorRank = SEVERITIES.indexOf(
        profile?.["severity-floor"] ?? "low",
      );
      const selected = controls.filter(
        (c) => SEVERITIES.indexOf(c.severity) <= floorRank,
      );
      const results = await evaluateControls(selected, ctx, {
        now: options.now,
        profile,
        waivers,
      });
      const s = summarize(results);
      rows.push({
        repo: repoPath,
        ok: true,
        pass: s.pass,
        fail: s.fail,
        needsEvidence: s.needsEvidence,
        total: s.total,
        criticalFail: results.some(
          (r) => r.severity === "critical" && r.status === "fail",
        ),
      });
    } catch (err) {
      const msg =
        err instanceof ProfileError ||
        err instanceof WaiverError ||
        err instanceof EvidenceError
          ? err.message
          : (err as Error).message;
      rows.push({ repo: repoPath, ok: false, error: msg });
    }
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(rows)}\n`);
  }
  // Exit non-zero if any repo has a critical failure.
  return rows.some((r) => r.criticalFail) ? 1 : 0;
}

function render(rows: RepoRow[]): string {
  const width = Math.max(4, ...rows.map((r) => r.repo.length));
  const lines = [
    `${"repo".padEnd(width)}  pass  fail  need-ev  total`,
    `${"-".repeat(width)}  ----  ----  -------  -----`,
  ];
  for (const r of rows) {
    if (!r.ok) {
      lines.push(`${r.repo.padEnd(width)}  (error: ${r.error})`);
      continue;
    }
    const mark = r.criticalFail ? " ✗" : "";
    lines.push(
      `${r.repo.padEnd(width)}  ${String(r.pass).padStart(4)}  ${String(
        r.fail,
      ).padStart(4)}  ${String(r.needsEvidence).padStart(7)}  ${String(
        r.total,
      ).padStart(5)}${mark}`,
    );
  }
  return lines.join("\n");
}
