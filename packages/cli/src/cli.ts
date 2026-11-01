import { Command, Option } from "commander";

import { type AuditFlags, runAudit } from "./commands/audit.js";
import { runProfileSet, runProfileShow } from "./commands/profile.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("factory")
    .description("An auditor and scaffolder for GitHub repositories");

  program
    .command("audit")
    .description("Audit a repo against the control catalog")
    .argument("[path]", "path to the repo to audit", ".")
    .option("--json", "output JSON instead of a table")
    .addOption(
      new Option("--format <format>", "output format").choices([
        "table",
        "json",
      ]),
    )
    .option("--lane <lane>", "only run controls in this lane")
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

  return program;
}

export async function run(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}
