import { Command, Option } from "commander";

import { type AiFlags, runAi, runAiUsage } from "./commands/ai.js";
import { type AuditFlags, runAudit } from "./commands/audit.js";
import { runCi } from "./commands/ci.js";
import { type EvidenceFlags, runEvidenceAdd } from "./commands/evidence.js";
import { type FixFlags, runFix } from "./commands/fix.js";
import { type InitFlags, runInit } from "./commands/init.js";
import { type MetricsFlags, runMetrics } from "./commands/metrics.js";
import { type MultiFlags, runAuditAll } from "./commands/multi.js";
import { runProfileSet, runProfileShow } from "./commands/profile.js";
import { type StatusFlags, runStatus } from "./commands/status.js";
import { runWaive, type WaiveFlags } from "./commands/waive.js";
import { today } from "./dates.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("factory")
    .description("An auditor and scaffolder for GitHub repositories");

  program
    .command("init")
    .description(
      "Set up .factory config and a workflow, then run the first audit",
    )
    .argument("[path]", "path to the repo", ".")
    .option("--type <type>", "project type (non-interactive)")
    .option("--name <name>", "project name")
    .option("--phase <phase>", "current lifecycle phase")
    .option("--stack <csv>", "comma-separated stack")
    .option("--flag <flag>", "risk flag that applies (repeatable)", collect, [])
    .option(
      "--severity-floor <severity>",
      "ignore controls below this severity",
    )
    .option("--license <spdx>", "project license, an SPDX id (default MIT)")
    .option("--owner <handle>", "code owner, a GitHub @handle or @org/team")
    .option(
      "--security-contact <contact>",
      "where to report vulnerabilities (email or URL)",
    )
    .option("--yes", "non-interactive; use flags and defaults")
    .option("--force", "overwrite existing .factory config")
    .action(async (path: string, flags: InitFlags) => {
      process.exitCode = await runInit(path, flags);
    });

  program
    .command("audit")
    .description("Audit a repo against the control catalog")
    .argument("[path]", "path to the repo to audit", ".")
    .option("--json", "output JSON instead of a table")
    .addOption(
      new Option("--format <format>", "output format").choices([
        "table",
        "json",
        "markdown",
        "github",
      ]),
    )
    .option("--lane <lane>", "only run controls in this lane")
    .option(
      "--gate <phase>",
      "evaluate a phase gate (or 'all') and fail if red",
    )
    .option("--token <token>", "GitHub token (else GITHUB_TOKEN or gh auth)")
    .option("--no-color", "disable coloured output")
    .option("--all", "audit every repo in the repo list (combined table)")
    .option(
      "--repos <file>",
      "repo list file (default ~/.config/factory/repos.yml)",
    )
    .action(async (path: string, flags: AuditFlags & MultiFlags) => {
      process.exitCode = flags.all
        ? await runAuditAll(flags)
        : await runAudit(path, flags);
    });

  program
    .command("fix")
    .description("Generate fixes for non-passing controls (dry-run by default)")
    .argument("[path]", "path to the repo", ".")
    .option(
      "--control <id>",
      "fix only this control (applied regardless of the severity floor)",
    )
    .option("--gate <phase>", "fix only controls in this gate")
    .option("--lane <lane>", "fix only controls in this lane")
    .option("--write", "apply changes locally (default: dry-run preview)")
    .option("--pr", "apply on a factory branch and open/reuse a pull request")
    .option(
      "--token <token>",
      "GitHub token (for --pr and github-setting fixes)",
    )
    .option("--no-color", "disable coloured output")
    .action(async (path: string, flags: FixFlags) => {
      process.exitCode = await runFix(path, flags, { today: today() });
    });

  program
    .command("status")
    .description("Infer the project phase and list what blocks progress")
    .argument("[path]", "path to the repo", ".")
    .option("--json", "output JSON instead of text")
    .option("--token <token>", "GitHub token (else GITHUB_TOKEN or gh auth)")
    .option("--no-color", "disable coloured output")
    .action(async (path: string, flags: StatusFlags) => {
      process.exitCode = await runStatus(path, flags);
    });

  program
    .command("metrics")
    .description("Show DORA metrics for the repo (from the GitHub API)")
    .argument("[path]", "path to the repo", ".")
    .option("--json", "output JSON instead of text")
    .option("--window <days>", "trailing window in days (default 90)")
    .option("--token <token>", "GitHub token (else GITHUB_TOKEN or gh auth)")
    .action(async (path: string, flags: MetricsFlags) => {
      process.exitCode = await runMetrics(path, flags);
    });

  program
    .command("ai")
    .description("Draft an artifact with Claude (dry-run by default)")
    .argument("<task>", "task to run (e.g. explain-gaps, threat-model, adr)")
    .argument("[path]", "path to the repo", ".")
    .option("--write", "apply the generated file locally (default: dry-run)")
    .option("--pr", "apply on a factory branch and open/reuse a pull request")
    .option("--token <token>", "GitHub token (for --pr)")
    .option("--no-color", "disable coloured output")
    .action(async (task: string, path: string, flags: AiFlags) => {
      // `factory ai usage` is a reserved task that reports the usage log.
      if (task === "usage") {
        process.exitCode = await runAiUsage(path);
        return;
      }
      process.exitCode = await runAi(task, path, flags, { today: today() });
    });

  const profile = program
    .command("profile")
    .description("Show or edit the repo's .factory/profile.yml");

  profile
    .command("show")
    .argument("[path]", "path to the repo", ".")
    .action(async (path: string) => {
      process.exitCode = await runProfileShow(path);
    });

  profile
    .command("set")
    .argument("<key>", "profile key (e.g. type, phase, flags.handles-pii)")
    .argument("<value>", "new value")
    .argument("[path]", "path to the repo", ".")
    .action(async (key: string, value: string, path: string) => {
      process.exitCode = await runProfileSet(key, value, path);
    });

  program
    .command("waive")
    .description("Record a waiver for a control")
    .argument("<control>", "control id to waive")
    .argument("[path]", "path to the repo", ".")
    .requiredOption("--reason <reason>", "why the control is waived")
    .requiredOption("--expires <date>", "expiry date (YYYY-MM-DD)")
    .option("--owner <owner>", "who owns this waiver")
    .action(async (control: string, path: string, flags: WaiveFlags) => {
      process.exitCode = await runWaive(control, flags, path, today());
    });

  const evidence = program
    .command("evidence")
    .description("Attach evidence for manual controls");

  evidence
    .command("add")
    .argument("<control>", "control id the evidence is for")
    .argument("[path]", "path to the repo", ".")
    .option("--url <url>", "link to the evidence")
    .option("--file <file>", "local file to hash (sha256) as evidence")
    .option("--note <note>", "a short note")
    .option("--reviewer <reviewer>", "who reviewed it")
    .option("--valid-for <duration>", "age-out window, e.g. 365d")
    .action(async (control: string, path: string, flags: EvidenceFlags) => {
      process.exitCode = await runEvidenceAdd(control, flags, path, today());
    });

  program
    .command("ci", { hidden: true })
    .description("GitHub Action entrypoint (driven by GITHUB_* env vars)")
    .action(async () => {
      process.exitCode = await runCi();
    });

  return program;
}

export async function run(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}
