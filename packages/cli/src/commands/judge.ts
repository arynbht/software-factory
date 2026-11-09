import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { runTier1, type Tier1Result } from "@arynbht/factory-runtime";
import pc from "picocolors";

export interface JudgeFlags {
  base?: string;
  head?: string;
  check?: string[];
  json?: boolean;
  keep?: boolean;
  install?: boolean;
  workDir?: string;
  color?: boolean;
}

const EXIT: Record<Tier1Result["verdict"], number> = {
  pass: 0,
  fail: 1,
  "needs-human": 2,
};

/**
 * `factory judge` — tier 1 of the judge: deterministic checks on a clean clone
 * of base plus the change, with protected paths taken from base. Exits 0 on
 * pass, 1 on fail, 2 when the change needs a human (it touched what judges it).
 */
export async function runJudge(
  path: string,
  flags: JudgeFlags,
): Promise<number> {
  const root = resolve(path);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`factory judge: not a directory: ${path}`);
    return 1;
  }

  let result: Tier1Result;
  try {
    result = await runTier1({
      repoPath: root,
      base: flags.base ?? "origin/main",
      head: flags.head,
      checks: flags.check && flags.check.length > 0 ? flags.check : undefined,
      keep: flags.keep,
      install: flags.install,
      workDir: flags.workDir,
      log: flags.json
        ? undefined
        : (line) => process.stderr.write(`· ${line}\n`),
    });
  } catch (err) {
    console.error(`factory judge: ${(err as Error).message}`);
    return 1;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const color = flags.color !== false && process.stdout.isTTY === true;
    process.stdout.write(`${renderJudge(result, color)}\n`);
  }
  return EXIT[result.verdict];
}

export function renderJudge(result: Tier1Result, color: boolean): string {
  const c = pc.createColors(color);
  const lines: string[] = [];
  const short = (sha: string) => sha.slice(0, 8);
  lines.push(
    `Judge · tier 1 · ${short(result.mergeBase)}..${short(result.head)} · ${result.changedFiles} file(s) changed`,
  );

  if (result.protected.length > 0) {
    lines.push("", c.yellow("Protected changes (a human must approve these):"));
    for (const p of result.protected) {
      lines.push(`  ! ${p.path} — ${p.detail}`);
    }
  }

  lines.push("", "Checks (base → change)");
  const mark: Record<string, string> = {
    pass: c.green("✓"),
    fixed: c.green("✓"),
    fail: c.red("✗"),
    "pre-existing": c.yellow("~"),
    "n/a": c.dim("·"),
  };
  for (const check of result.checks) {
    const label = `${check.id}`.padEnd(30);
    const note =
      check.outcome === "pre-existing"
        ? c.yellow("pre-existing (red on base too)")
        : check.outcome === "fixed"
          ? c.green("fixed by this change")
          : check.outcome === "n/a"
            ? c.dim("n/a")
            : `${check.base} → ${check.head}`;
    lines.push(`  ${mark[check.outcome] ?? "?"} ${label} ${note}`);
    if (check.outcome === "fail" || check.outcome === "pre-existing") {
      for (const l of check.message.split("\n").slice(0, 6)) {
        lines.push(c.dim(`      ${l}`));
      }
    }
  }
  for (const note of result.notes) lines.push("", c.red(`  ${note}`));

  const verdict =
    result.verdict === "pass"
      ? c.green("PASS")
      : result.verdict === "fail"
        ? c.red("FAIL")
        : c.yellow("NEEDS HUMAN");
  lines.push("", `Verdict: ${verdict}`);
  return lines.join("\n");
}
