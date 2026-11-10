import { Command, Option } from "commander";

import { type AiFlags, runAi, runAiUsage } from "./commands/ai.js";
import { type AuditFlags, runAudit } from "./commands/audit.js";
import { type BuildFlags, runBuildCommand } from "./commands/build.js";
import { runCi } from "./commands/ci.js";
import { type EvidenceFlags, runEvidenceAdd } from "./commands/evidence.js";
import { type FixFlags, runFix } from "./commands/fix.js";
import { type InitFlags, runInit } from "./commands/init.js";
import { type JudgeFlags, runJudge } from "./commands/judge.js";
import { type ReviewFlags, runReview } from "./commands/review.js";
import {
  runTaskApprove,
  runTaskConfirm,
  runTaskNew,
  runTaskResume,
  runTaskRoute,
  runTaskStatus,
  type TaskNewFlags,
} from "./commands/task.js";
import {
  runSkillsAdd,
  runSkillsInit,
  runSkillsStatus,
  runSkillsSync,
  runSkillsUpdate,
  runSkillsVendor,
  type SkillsFlags,
} from "./commands/skills.js";
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
    .command("review")
    .description(
      "Judge tier 2: an AI review where only defects, contract breaches and unmet acceptance criteria block",
    )
    .argument("[path]", "path to the repo", ".")
    .option("--pr <number>", "review this pull request and post one review")
    .option("--dry-run", "with --pr: print the review instead of posting it")
    .option(
      "--base <ref>",
      "local mode: the base the change targets",
      "origin/main",
    )
    .option("--head <ref>", "local mode: the change (default HEAD)")
    .option(
      "--task <id>",
      "review against this confirmed task card's acceptance criteria",
    )
    .option("--model <model>", "judge model (default: profile ai.judge_model)")
    .option(
      "--token <token>",
      "GitHub token for --pr (else GITHUB_TOKEN or gh auth)",
    )
    .option("--json", "output JSON")
    .action(async (path: string, flags: ReviewFlags) => {
      process.exitCode = await runReview(path, flags);
    });

  const task = program
    .command("task")
    .description("Task cards and their ledgers: intake before anything runs");
  task
    .command("new")
    .description("Draft a task card (acceptance items need a verify kind)")
    .argument("[title]", "what the task is")
    .option("--type <type>", "feature | fix | chore | refactor | spike")
    .option("--description <text>", "what and why")
    .option(
      "--accept <text::verify>",
      'an acceptance criterion and how it\'s verified, e.g. "Settings render::e2e" (repeatable)',
      collect,
      [],
    )
    .option(
      "--out-of-scope <text>",
      "explicitly not part of it (repeatable)",
      collect,
      [],
    )
    .option(
      "--touches <glob>",
      "paths it should touch (repeatable)",
      collect,
      [],
    )
    .option(
      "--constraint <text>",
      "e.g. no new dependencies (repeatable)",
      collect,
      [],
    )
    .option("--risk <risk>", "low | medium | high")
    .option("--source <source>", "issue#88, or prompt")
    .option("--from <file>", "start from a card YAML file")
    .option("--path <path>", "path to the repo", ".")
    .action(async (title: string | undefined, flags: TaskNewFlags) => {
      process.exitCode = await runTaskNew(title, flags);
    });
  task
    .command("confirm")
    .description("Agree the card; nothing runs on an unconfirmed card")
    .argument("<id>", "task id, e.g. T-0001")
    .option("--yes", "confirm without the prompt (recorded as --yes)")
    .option("--path <path>", "path to the repo", ".")
    .action(async (id: string, flags: { yes?: boolean; path?: string }) => {
      process.exitCode = await runTaskConfirm(id, flags);
    });
  task
    .command("route")
    .description(
      "Route a confirmed card: sectors, skills, checks, proof and budget, with reasons",
    )
    .argument("<id>", "task id")
    .option("--path <path>", "path to the repo", ".")
    .action(async (id: string, flags: { path?: string }) => {
      process.exitCode = await runTaskRoute(id, flags);
    });
  task
    .command("approve")
    .description(
      "Approve the routed assembly; the last approval before the agent starts",
    )
    .argument("<id>", "task id")
    .option("--yes", "approve without the prompt (recorded as --yes)")
    .option("--path <path>", "path to the repo", ".")
    .action(async (id: string, flags: { yes?: boolean; path?: string }) => {
      process.exitCode = await runTaskApprove(id, flags);
    });
  task
    .command("status")
    .description("List tasks, their beat, and whether their records are intact")
    .option("--path <path>", "path to the repo", ".")
    .action(async (flags: { path?: string }) => {
      process.exitCode = await runTaskStatus(flags);
    });
  task
    .command("resume")
    .description("Verify a task's ledger and show where it left off")
    .argument("<id>", "task id")
    .option("--path <path>", "path to the repo", ".")
    .action(async (id: string, flags: { path?: string }) => {
      process.exitCode = await runTaskResume(id, flags);
    });

  const skills = program
    .command("skills")
    .description("Pinned, hashed, scanned agent skills for this repo");
  skills
    .command("init")
    .description("Lock the skills the factory ships manifests for")
    .argument("[path]", "path to the repo", ".")
    .option("--spine-only", "only the always-scope skills")
    .action(
      async (path: string, flags: SkillsFlags & { spineOnly?: boolean }) => {
        process.exitCode = await runSkillsInit(path, flags);
      },
    );
  skills
    .command("sync")
    .description(
      "Fetch, verify, scan and install the skills in .factory/skills.lock",
    )
    .argument("[path]", "path to the repo", ".")
    .option("--refetch", "replace a cache entry that fails its hash")
    .action(async (path: string, flags: SkillsFlags) => {
      process.exitCode = await runSkillsSync(path, flags);
    });
  skills
    .command("status")
    .description("Check installed skills against the lock (fails when stale)")
    .argument("[path]", "path to the repo", ".")
    .action(async (path: string) => {
      process.exitCode = await runSkillsStatus(path);
    });
  skills
    .command("add")
    .description("Pin a skill (owner/repo[/path]) and add it to the lock")
    .argument("<source>", "owner/repo or owner/repo/path/to/skill")
    .argument("[path]", "path to the repo", ".")
    .option("--pin <sha>", "commit to pin (default: the source's HEAD)")
    .option("--name <name>", "install directory name")
    .option("--scope <scope>", "always | task")
    .option("--sectors <csv>", "sectors, for skills without a shipped manifest")
    .option("--phases <csv>", "phases, for skills without a shipped manifest")
    .option(
      "--license <spdx>",
      "license, for skills without a shipped manifest",
    )
    .action(async (source: string, path: string, flags: SkillsFlags) => {
      process.exitCode = await runSkillsAdd(source, path, flags);
    });
  skills
    .command("update")
    .description("Show what changed upstream; move the lock only with --yes")
    .argument("[name]", "one skill (default: all)")
    .option("--path <path>", "path to the repo", ".")
    .option("--yes", "apply: move the lock to the reviewed commits")
    .action(
      async (
        name: string | undefined,
        flags: SkillsFlags & { path: string },
      ) => {
        process.exitCode = await runSkillsUpdate(name, flags.path, flags);
      },
    );
  skills
    .command("vendor")
    .description(
      "Copy verified skills into .factory/vendor/skills/ for offline runs",
    )
    .argument("[path]", "path to the repo", ".")
    .option("--refetch", "replace a cache entry that fails its hash")
    .action(async (path: string, flags: SkillsFlags) => {
      process.exitCode = await runSkillsVendor(path, flags);
    });

  program
    .command("judge")
    .description(
      "Judge a change: lint/typecheck/tests on a clean clone of base + the change, with protected paths from base",
    )
    .argument("[path]", "path to the repo", ".")
    .option("--base <ref>", "the base the change targets", "origin/main")
    .option("--head <ref>", "the change to judge (default HEAD)")
    .option(
      "--check <id>",
      "a control to run (repeatable; default: the quality lane)",
      collect,
      [],
    )
    .option("--json", "output JSON")
    .option("--keep", "keep the clean clone for inspection")
    .option("--work-dir <dir>", "clone here instead of a temp dir")
    .option("--no-install", "don't install dependencies in the clone")
    .option(
      "--review",
      "then run tier 2, the AI review (skipped when tier 1 needs a human)",
    )
    .option(
      "--model <model>",
      "judge model for --review (default: profile ai.judge_model)",
    )
    .option(
      "--env <name>",
      "pass this environment variable to installs and checks (repeatable; default: none beyond system paths)",
      collect,
      [],
    )
    .option("--no-color", "disable coloured output")
    .action(async (path: string, flags: JudgeFlags) => {
      process.exitCode = await runJudge(path, flags);
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
    .option(
      "--commands",
      "run command checks (lint, typecheck, tests) instead of skipping them",
    )
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

  program
    .command("build")
    .description(
      "Plan and build a feature/fix with agents, then open a gated PR",
    )
    .argument("<description>", "what to build (quote it)")
    .argument("[path]", "path to the repo", ".")
    .option("--yes", "approve the plan and build it (default: plan only)")
    .option("--no-push", "stop at a local branch; don't push or open a PR")
    .option("--token <token>", "GitHub token (for opening the PR)")
    .option("--model <model>", "Claude model override")
    .option("--no-color", "disable coloured output")
    .action(async (description: string, path: string, flags: BuildFlags) => {
      process.exitCode = await runBuildCommand(description, path, flags, {
        today: today(),
      });
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
