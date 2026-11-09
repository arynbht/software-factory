import { resolve } from "node:path";

import {
  addSkill,
  initLock,
  RegistryError,
  SkillFetchError,
  SkillHashError,
  skillsStatus,
  syncSkills,
  updateSkills,
  vendorSkills,
} from "@arynbht/factory-registry";

export interface SkillsFlags {
  refetch?: boolean;
  pin?: string;
  name?: string;
  scope?: "always" | "task";
  sectors?: string;
  phases?: string;
  license?: string;
  yes?: boolean;
}

const log = (line: string) => process.stderr.write(`· ${line}\n`);
const csv = (value: string | undefined) =>
  value
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Turn the registry's expected failures into a message and exit 1. */
async function guarded(action: () => Promise<number>): Promise<number> {
  try {
    return await action();
  } catch (err) {
    if (
      err instanceof RegistryError ||
      err instanceof SkillFetchError ||
      err instanceof SkillHashError
    ) {
      console.error(`factory skills: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

export function runSkillsSync(
  path: string,
  flags: SkillsFlags,
): Promise<number> {
  return guarded(async () => {
    const result = await syncSkills(resolve(path), {
      refetch: flags.refetch,
      log,
    });
    for (const b of result.blocked) {
      console.error(`✗ ${b.name}: ${b.reason}`);
      for (const f of b.findings ?? []) {
        console.error(`    ${f.rule} ${f.file}:${f.line}  ${f.text}`);
      }
    }
    process.stdout.write(
      `${result.installed.length} installed, ${result.staged.length} staged for tasks, ${result.blocked.length} blocked\n`,
    );
    return result.blocked.length > 0 ? 1 : 0;
  });
}

export function runSkillsInit(
  path: string,
  flags: SkillsFlags & { spineOnly?: boolean },
): Promise<number> {
  return guarded(async () => {
    const added = await initLock(resolve(path), { spineOnly: flags.spineOnly });
    process.stdout.write(
      added.length > 0
        ? `locked ${added.map((e) => e.name).join(", ")}; run \`factory skills sync\`\n`
        : "the lock already has every shipped skill\n",
    );
    return 0;
  });
}

export function runSkillsStatus(path: string): Promise<number> {
  return guarded(async () => {
    const problems = await skillsStatus(resolve(path));
    if (problems.length === 0) {
      process.stdout.write("skills are in sync with the lock\n");
      return 0;
    }
    for (const p of problems) console.error(`✗ ${p}`);
    return 1;
  });
}

export function runSkillsAdd(
  source: string,
  path: string,
  flags: SkillsFlags,
): Promise<number> {
  return guarded(async () => {
    const { entry, manifestPath } = await addSkill(resolve(path), source, {
      pin: flags.pin,
      name: flags.name,
      scope: flags.scope,
      sectors: csv(flags.sectors),
      phases: csv(flags.phases),
      license: flags.license,
      log,
    });
    process.stdout.write(
      `added ${entry.name} @ ${entry.pin.slice(0, 12)} (${entry.hash.slice(0, 19)}…, ${entry.scope})\n`,
    );
    if (manifestPath)
      process.stdout.write(`wrote ${manifestPath}; review it\n`);
    process.stdout.write("run `factory skills sync` to install\n");
    return 0;
  });
}

export function runSkillsUpdate(
  name: string | undefined,
  path: string,
  flags: SkillsFlags,
): Promise<number> {
  return guarded(async () => {
    const plans = await updateSkills(resolve(path), name, {
      apply: flags.yes,
      log,
    });
    if (plans.length === 0) {
      process.stdout.write("every skill is at its source's latest commit\n");
      return 0;
    }
    let blocked = false;
    for (const plan of plans) {
      process.stdout.write(
        `\n## ${plan.name}: ${plan.from.slice(0, 12)} → ${plan.to.slice(0, 12)}\n${plan.diff}\n`,
      );
      if (plan.findings.length > 0) {
        blocked = true;
        process.stdout.write("scan findings (not applied):\n");
        for (const f of plan.findings) {
          process.stdout.write(`  ${f.rule} ${f.file}:${f.line}  ${f.text}\n`);
        }
      }
      process.stdout.write(plan.applied ? "→ lock updated\n" : "");
    }
    if (!flags.yes) {
      process.stdout.write(
        "\nReview the diffs above; re-run with --yes to move the lock, then `factory skills sync`.\n",
      );
    }
    return blocked ? 1 : 0;
  });
}

export function runSkillsVendor(
  path: string,
  flags: SkillsFlags,
): Promise<number> {
  return guarded(async () => {
    const names = await vendorSkills(resolve(path), {
      refetch: flags.refetch,
      log,
    });
    process.stdout.write(
      `vendored ${names.length} skill(s) into .factory/vendor/skills/ (commit them for offline runs)\n`,
    );
    return 0;
  });
}
