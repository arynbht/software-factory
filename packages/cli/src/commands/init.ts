import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  FLAG_KEYS,
  PHASE_KEYS,
  PROJECT_TYPES,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import { ProfileError, saveProfile } from "@arynbht/factory-engine";
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

export interface InitFlags {
  type?: string;
  name?: string;
  phase?: string;
  stack?: string;
  flag?: string[];
  severityFloor?: string;
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

interface ProfileDraft {
  version: 1;
  name: string;
  type: string;
  stack: string[];
  phase?: string;
  flags: Record<string, boolean>;
  "severity-floor": string;
}

function draftFromFlags(flags: InitFlags, root: string): ProfileDraft {
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
  };
  if (flags.phase) draft.phase = flags.phase;
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
  return draft;
}

/** `factory init` — scaffold .factory config + a workflow, then run the first audit. */
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
    draft = draftFromFlags(flags, root);
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

  if (interactive) {
    outro(
      "Wrote .factory/ and .github/workflows/factory.yml. Running first audit…",
    );
  } else {
    process.stdout.write(
      "Wrote .factory/ and .github/workflows/factory.yml. Running first audit…\n\n",
    );
  }

  return runAudit(root, {}, options);
}
