import { Command, Option } from "commander";

import { type AuditFlags, runAudit } from "./commands/audit.js";
import { runCi } from "./commands/ci.js";
import { type EvidenceFlags, runEvidenceAdd } from "./commands/evidence.js";
import { type InitFlags, runInit } from "./commands/init.js";
import { runProfileSet, runProfileShow } from "./commands/profile.js";
import { runWaive, type WaiveFlags } from "./commands/waive.js";

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
    .action(async (path: string, flags: AuditFlags) => {
      process.exitCode = await runAudit(path, flags);
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
      const today = new Date().toISOString().slice(0, 10);
      process.exitCode = await runWaive(control, flags, path, today);
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
      const today = new Date().toISOString().slice(0, 10);
      process.exitCode = await runEvidenceAdd(control, flags, path, today);
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
