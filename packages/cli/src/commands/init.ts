import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import {
  bundledSkillDir,
  FLAG_KEYS,
  PHASE_KEYS,
  PROJECT_TYPES,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  buildContext,
  detectStacks,
  packageManager,
  ProfileError,
  resolveRepoSlug,
  saveProfile,
} from "@arynbht/factory-engine";
import { initLock } from "@arynbht/factory-registry";
import {
  cancel,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";

import { runAudit, type RunAuditOptions } from "./audit.js";
import {
  CLAUDE_MD,
  PR_TEMPLATE,
  renderAgentsMd,
  renderConstraintsMd,
  type RepoFacts,
  SETTINGS_JSON,
} from "./init-files.js";

export interface InitFlags {
  type?: string;
  name?: string;
  phase?: string;
  stack?: string;
  flag?: string[];
  severityFloor?: string;
  license?: string;
  owner?: string;
  securityContact?: string;
  yes?: boolean;
  force?: boolean;
}

/** The factory.yml workflow written into the target repo. */
function buildWorkflow(phase: string): string {
  return `name: factory
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "17 6 * * 1" # Mondays 06:17 UTC
  workflow_dispatch:

# Least privilege by default; each job widens only what it needs.
permissions:
  contents: read

# One run per ref so a newer push/PR update supersedes an in-flight run and the two
# can't race on the sticky comment or the status issue.
concurrency:
  group: factory-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  # PR runs post a sticky review comment — pull-requests:write only.
  audit-pr:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      # Pin to a commit SHA for supply-chain safety; @v1 shown for readability.
      - uses: arynbht/software-factory/packages/action@v1
        with:
          gate: ${phase}
          token: \${{ secrets.GITHUB_TOKEN }}

  # Scheduled / push / manual runs maintain the pinned status issue — issues:write only.
  audit-status:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: arynbht/software-factory/packages/action@v1
        with:
          gate: ${phase}
          token: \${{ secrets.GITHUB_TOKEN }}
`;
}

/** Write a file unless it already exists (so init never clobbers without --force). */
async function writeIfAllowed(
  path: string,
  content: string,
  force: boolean | undefined,
): Promise<void> {
  if (!force) {
    const exists = await access(path)
      .then(() => true)
      .catch(() => false);
    if (exists) return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/**
 * Write a generated file without clobbering (§10): a missing file is written,
 * an identical one left alone, and a different one gets the factory's version
 * beside it as `name.factory.ext` (or overwritten with --force). Returns the
 * path written, relative to the repo.
 */
async function writeBeside(
  root: string,
  rel: string,
  content: string,
  force: boolean | undefined,
): Promise<string> {
  const path = resolve(root, rel);
  const existing = await readFile(path, "utf8").catch(() => null);
  if (existing === null || force || existing === content) {
    if (existing !== content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    return rel;
  }
  const ext = extname(rel);
  const besideRel = `${rel.slice(0, rel.length - ext.length)}.factory${ext}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(resolve(root, besideRel), content, "utf8");
  return besideRel;
}

/** Add lines to .factory/.gitignore that aren't there yet. */
async function ignoreInFactory(root: string, lines: string[]): Promise<void> {
  const path = resolve(root, ".factory", ".gitignore");
  const text = await readFile(path, "utf8").catch(() => "");
  const have = new Set(text.split(/\r?\n/));
  const add = lines.filter((l) => !have.has(l));
  if (add.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${text}${text && !text.endsWith("\n") ? "\n" : ""}${add.join("\n")}\n`,
    "utf8",
  );
}

/** What AGENTS.md and CONSTRAINTS.md say about the repo: stacks and its own commands. */
async function repoFacts(
  root: string,
  draft: ProfileDraft,
): Promise<RepoFacts> {
  const stacks = await detectStacks(buildContext(root)).catch(() => []);
  const commands: RepoFacts["commands"] = {};
  const pkg = await readFile(resolve(root, "package.json"), "utf8")
    .then((t) => JSON.parse(t) as { scripts?: Record<string, string> })
    .catch(() => null);
  if (pkg) {
    const pm = await packageManager(root).catch(() => "npm");
    commands.install = `${pm} install`;
    const scripts = pkg.scripts ?? {};
    for (const [key, names] of [
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["test", ["test"]],
    ] as const) {
      const name = names.find((n) => scripts[n]);
      if (name) commands[key] = `${pm} run ${name}`;
    }
  }
  return {
    name: draft.name,
    type: draft.type,
    phase: draft.phase,
    stack: draft.stack,
    flags: Object.keys(draft.flags).filter((f) => draft.flags[f]),
    stacks,
    commands,
  };
}

interface ProfileDraft {
  version: 1;
  name: string;
  type: string;
  stack: string[];
  phase?: string;
  flags: Record<string, boolean>;
  "severity-floor": string;
  project?: ProjectDraft;
}

interface ProjectDraft {
  license?: string | undefined;
  owner?: string | undefined;
  "security-contact"?: string | undefined;
}

/**
 * Defaults for the `project:` block from the repo's GitHub remote: the owner
 * handle, and GitHub's private vulnerability reporting as the security contact.
 * No remote means no default — templates then say what to set rather than
 * shipping a placeholder.
 */
async function projectDefaults(root: string): Promise<ProjectDraft> {
  const slug = await resolveRepoSlug(root);
  return {
    license: "MIT",
    ...(slug
      ? {
          owner: `@${slug.owner}`,
          "security-contact": `https://github.com/${slug.owner}/${slug.repo}/security/advisories/new`,
        }
      : {}),
  };
}

function withoutEmpty(project: ProjectDraft): ProjectDraft | undefined {
  const entries = Object.entries(project).filter(([, v]) => Boolean(v));
  return entries.length > 0
    ? (Object.fromEntries(entries) as ProjectDraft)
    : undefined;
}

async function draftFromFlags(
  flags: InitFlags,
  root: string,
): Promise<ProfileDraft> {
  const defaults = await projectDefaults(root);
  const draft: ProfileDraft = {
    version: 1,
    name: flags.name ?? basename(root),
    type: flags.type ?? "",
    stack: flags.stack
      ? flags.stack
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    flags: Object.fromEntries((flags.flag ?? []).map((f) => [f, true])),
    "severity-floor": flags.severityFloor ?? "low",
    phase: flags.phase ?? "scaffold",
  };
  const project = withoutEmpty({
    license: flags.license ?? defaults.license,
    owner: flags.owner ?? defaults.owner,
    "security-contact": flags.securityContact ?? defaults["security-contact"],
  });
  if (project) draft.project = project;
  return draft;
}

async function draftInteractive(root: string): Promise<ProfileDraft | null> {
  intro("factory init");

  const name = await text({
    message: "Project name",
    initialValue: basename(root),
  });
  if (isCancel(name)) return null;

  const type = await select({
    message: "Project type",
    options: PROJECT_TYPES.map((t) => ({ value: t, label: t })),
  });
  if (isCancel(type)) return null;

  const phase = await select({
    message: "Current phase",
    options: PHASE_KEYS.map((p) => ({ value: p, label: p })),
    initialValue: "scaffold",
  });
  if (isCancel(phase)) return null;

  const stack = await text({
    message: "Stack (comma-separated, optional)",
    placeholder: "typescript, react, postgres",
    defaultValue: "",
  });
  if (isCancel(stack)) return null;

  const chosen = await multiselect({
    message: "Risk flags that apply (space to toggle)",
    options: FLAG_KEYS.map((f) => ({ value: f, label: f })),
    required: false,
  });
  if (isCancel(chosen)) return null;

  const floor = await select({
    message: "Severity floor (ignore controls below this)",
    options: SEVERITIES.map((s) => ({ value: s, label: s })),
    initialValue: "low",
  });
  if (isCancel(floor)) return null;

  const defaults = await projectDefaults(root);
  const license = await text({
    message: "License (SPDX id)",
    initialValue: defaults.license ?? "",
  });
  if (isCancel(license)) return null;

  const owner = await text({
    message: "Code owner (GitHub @handle or @org/team)",
    initialValue: defaults.owner ?? "",
    placeholder: "@your-handle",
  });
  if (isCancel(owner)) return null;

  const contact = await text({
    message: "Where to report vulnerabilities (email or URL)",
    initialValue: defaults["security-contact"] ?? "",
  });
  if (isCancel(contact)) return null;

  const draft: ProfileDraft = {
    version: 1,
    name: String(name),
    type: String(type),
    stack: String(stack)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    phase: String(phase),
    flags: Object.fromEntries((chosen as string[]).map((f) => [f, true])),
    "severity-floor": String(floor),
  };
  const project = withoutEmpty({
    license: String(license).trim(),
    owner: String(owner).trim(),
    "security-contact": String(contact).trim(),
  });
  if (project) draft.project = project;
  return draft;
}

/**
 * `factory init`: the profile, the factory workflow, and the §10 files (the
 * AGENTS.md contract, the /factory skill and its hooks, the PR template), then
 * the first audit.
 */
export async function runInit(
  path: string,
  flags: InitFlags,
  options: RunAuditOptions = {},
): Promise<number> {
  const root = resolve(path);

  const profileExists = await access(resolve(root, ".factory", "profile.yml"))
    .then(() => true)
    .catch(() => false);
  if (profileExists && !flags.force) {
    console.error(
      "factory init: .factory/profile.yml already exists. Use --force to overwrite, or `factory profile set`.",
    );
    return 1;
  }

  const interactive =
    !flags.yes && !flags.type && process.stdout.isTTY === true;

  let draft: ProfileDraft | null;
  if (interactive) {
    draft = await draftInteractive(root);
    if (!draft) {
      cancel("Cancelled.");
      return 1;
    }
  } else {
    draft = await draftFromFlags(flags, root);
    if (!draft.type) {
      console.error(
        `factory init: --type is required in non-interactive mode (one of: ${PROJECT_TYPES.join(", ")}).`,
      );
      return 1;
    }
  }

  try {
    await saveProfile(root, draft);
  } catch (err) {
    console.error(err instanceof ProfileError ? err.message : String(err));
    return 1;
  }

  const factoryDir = resolve(root, ".factory");
  await writeIfAllowed(resolve(factoryDir, "waivers.yml"), "[]\n", flags.force);
  await writeIfAllowed(
    resolve(factoryDir, "evidence.yml"),
    "[]\n",
    flags.force,
  );
  await writeIfAllowed(
    resolve(root, ".github", "workflows", "factory.yml"),
    buildWorkflow(draft.phase ?? "build"),
    flags.force,
  );

  await ignoreInFactory(root, ["tasks/", "ai-usage.log", "cache/"]);

  // §10: the contract, the /factory skill, the hooks, the PR template.
  const facts = await repoFacts(root, draft);
  const files: [string, string][] = [
    ["AGENTS.md", renderAgentsMd(facts)],
    ["CLAUDE.md", CLAUDE_MD],
    ["CONSTRAINTS.md", renderConstraintsMd(facts)],
    [".github/PULL_REQUEST_TEMPLATE.md", PR_TEMPLATE],
    [".claude/settings.json", SETTINGS_JSON],
    [
      ".claude/skills/factory/SKILL.md",
      await readFile(join(bundledSkillDir(), "SKILL.md"), "utf8"),
    ],
  ];
  const beside: string[] = [];
  for (const [rel, content] of files) {
    const written = await writeBeside(root, rel, content, flags.force);
    if (written !== rel) beside.push(`${rel} exists; wrote ${written}`);
  }

  // The spine skills, locked; `factory skills sync` installs them.
  let locked = "";
  try {
    const added = await initLock(root, { spineOnly: true });
    if (added.length > 0)
      locked = ` Locked the spine skills (${added.map((e) => e.name).join(", ")}); run \`factory skills sync\`.`;
  } catch (err) {
    locked = ` Couldn't lock the spine skills: ${(err as Error).message}`;
  }

  const wrote = `Wrote .factory/, AGENTS.md, CLAUDE.md, CONSTRAINTS.md, the /factory skill and hooks under .claude/, and .github/ (factory.yml, the PR template).${locked} Commit them to the default branch before the first task: the agent and the judge read the contract from there.`;
  const notes = beside.map((b) => `  - ${b}: merge it by hand`).join("\n");
  if (interactive) {
    outro(`${wrote}${notes ? `\n${notes}` : ""} Running first audit…`);
  } else {
    process.stdout.write(
      `${wrote}\n${notes ? `${notes}\n` : ""}Running first audit…\n\n`,
    );
  }

  return runAudit(root, {}, options);
}
