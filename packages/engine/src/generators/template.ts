import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { Control, Profile } from "@arynbht/factory-catalog";
import { bundledTemplatesDir } from "@arynbht/factory-catalog";
import { Eta } from "eta";
import { simpleGit } from "simple-git";

import type { AuditContext } from "../context.js";
import {
  declaredStacks,
  detectStacks,
  TEMPLATE_STACKS,
  type TemplateStack,
  templateStacks,
} from "../stack.js";
import type { Change, Generator } from "./types.js";

const eta = new Eta({ autoEscape: false });

/** SPDX ids the `license` template has full text for. */
export const SUPPORTED_LICENSES = ["MIT", "ISC"] as const;

export interface TemplateVars {
  name: string;
  year: number;
  type: string;
  /** Detected stacks (node, typescript, python, go, rust). */
  stack: string[];
  /** SPDX id from `project.license`; unset means "not chosen yet". */
  license: string | undefined;
  /** Code owner handle from `project.owner` (`@user` or `@org/team`). */
  owner: string | undefined;
  /** Copyright holder: `project.copyright-holder`, else the project name. */
  copyrightHolder: string;
  /** Vulnerability report channel from `project.security-contact`. */
  securityContact: string | undefined;
  flags: Record<string, boolean>;
  packageManager: "npm" | "pnpm" | "yarn";
  defaultBranch: string;
  /** Script names in package.json; CI runs only the checks the repo has. */
  scripts: string[];
}

/** Build template variables from the profile (with sensible fallbacks). */
export function templateVars(
  profile: Profile | null,
  year: number,
  repo: Partial<
    Pick<TemplateVars, "stack" | "packageManager" | "defaultBranch" | "scripts">
  > = {},
): TemplateVars {
  const project = profile?.project;
  return {
    name: profile?.name ?? "project",
    year,
    type: profile?.type ?? "library",
    stack: repo.stack ?? declaredStacks(profile?.stack ?? []),
    license: project?.license,
    owner: project?.owner,
    copyrightHolder:
      project?.["copyright-holder"] ?? profile?.name ?? "the authors",
    securityContact: project?.["security-contact"],
    flags: (profile?.flags as Record<string, boolean>) ?? {},
    packageManager: repo.packageManager ?? "npm",
    defaultBranch: repo.defaultBranch ?? "main",
    scripts: repo.scripts ?? [],
  };
}

/** Template variables for the repo behind `ctx`: profile plus what's on disk. */
export async function resolveTemplateVars(
  ctx: AuditContext,
): Promise<TemplateVars> {
  const profile = await ctx.profile().catch(() => null);
  return templateVars(profile, ctx.now.getFullYear(), {
    stack: await detectStacks(ctx),
    packageManager: await detectPackageManager(ctx),
    defaultBranch: await detectDefaultBranch(ctx.repoPath),
    scripts: await detectScripts(ctx),
  });
}

async function detectScripts(ctx: AuditContext): Promise<string[]> {
  try {
    const pkg = JSON.parse((await ctx.readFile("package.json")) ?? "{}") as {
      scripts?: Record<string, unknown>;
    };
    return Object.keys(pkg.scripts ?? {});
  } catch {
    return []; // unparseable package.json: no scripts to run
  }
}

async function detectPackageManager(
  ctx: AuditContext,
): Promise<TemplateVars["packageManager"]> {
  const pkg = (await ctx.readFile("package.json")) ?? "";
  const declared = /"packageManager"\s*:\s*"(pnpm|yarn|npm)@/.exec(pkg)?.[1];
  if (declared) return declared as TemplateVars["packageManager"];
  if ((await ctx.readFile("pnpm-lock.yaml")) !== null) return "pnpm";
  if ((await ctx.readFile("yarn.lock")) !== null) return "yarn";
  return "npm";
}

async function detectDefaultBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    const head = await git.raw([
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    const branch = head.trim().replace(/^origin\//, "");
    if (branch) return branch;
  } catch {
    // No origin/HEAD (no remote, or never fetched): fall back to the local branch.
  }
  try {
    const branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    if (branch) return branch;
  } catch {
    // Detached HEAD or not a repo.
  }
  return "main";
}

/**
 * Profile values a template cannot be rendered without. Rendering with a
 * placeholder (`@OWNER`, `security@example.com`) would satisfy the control while
 * leaving the repo wrong, so a missing value becomes a note instead.
 */
const REQUIRES: Record<string, (vars: TemplateVars) => string | null> = {
  codeowners: (v) =>
    v.owner
      ? null
      : "set project.owner (e.g. @your-handle) in .factory/profile.yml",
  security: (v) =>
    v.securityContact
      ? null
      : "set project.security-contact (an email or URL) in .factory/profile.yml",
  license: (v) => {
    if (!v.license) {
      return "set project.license (an SPDX id, e.g. MIT) in .factory/profile.yml";
    }
    if (!(SUPPORTED_LICENSES as readonly string[]).includes(v.license)) {
      return `no bundled text for ${v.license}; add it from https://spdx.org/licenses/${v.license}.html`;
    }
    return null;
  },
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const BUCKETS = new Set<string>([...TEMPLATE_STACKS, "common"]);

/**
 * Render a template directory into file changes. Files at the template root are
 * stack-agnostic; files under `common/` are always included; files under a stack
 * directory (`node/`, `python/`, `go/`, `rust/`) are included for each detected
 * stack. When two stacks render the same path (a `ci.yml` each), the first stack
 * in `vars.stack` wins. A `.eta` extension is rendered with the vars and stripped;
 * other files are copied verbatim.
 *
 * A template that needs a profile value which isn't set, or whose stack-specific
 * files match none of the repo's stacks, yields a `note` instead of guessing.
 */
export async function renderTemplate(
  templateName: string,
  vars: TemplateVars,
  controlId: string,
  managed?: boolean,
): Promise<Change[]> {
  const missing = REQUIRES[templateName]?.(vars);
  if (missing) {
    return [{ type: "note", controlId, message: `not scaffolded: ${missing}` }];
  }

  const base = resolve(bundledTemplatesDir(), templateName);
  const stacks = templateStacks(vars.stack);
  const files = await walk(base);
  const byPath = new Map<string, { rank: number; change: Change }>();
  let stackSpecific = false;

  for (const file of files) {
    const rel = relative(base, file).split(sep).join("/");
    const [first = "", ...rest] = rel.split("/");
    let outRel = rel;
    let rank = -1;
    if (BUCKETS.has(first)) {
      outRel = rest.join("/");
      if (first !== "common") {
        stackSpecific = true;
        rank = stacks.indexOf(first as TemplateStack);
        if (rank === -1) continue;
      }
    }

    const raw = await readFile(file, "utf8");
    const contents = outRel.endsWith(".eta")
      ? eta.renderString(raw, vars)
      : raw;
    const path = outRel.replace(/\.eta$/, "");
    const existing = byPath.get(path);
    if (existing && existing.rank <= rank) continue;
    byPath.set(path, {
      rank,
      change: {
        type: "file",
        controlId,
        path,
        contents,
        op: "create",
        ...(managed ? { managed } : {}),
      },
    });
  }

  const changes = [...byPath.values()].map((v) => v.change);
  if (changes.length === 0 && stackSpecific) {
    return [
      {
        type: "note",
        controlId,
        message:
          stacks.length === 0
            ? "not scaffolded: the repo's stack is unknown (no package.json, pyproject.toml, go.mod or Cargo.toml); set `stack` in .factory/profile.yml"
            : `not scaffolded: no ${templateName} template for ${stacks.join(", ")}`,
      },
    ];
  }
  return changes;
}

/** Generator for controls with `fix: { type: template, template: <name> }`. */
export const templateGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "template") return [];
  return renderTemplate(
    control.fix.template,
    await resolveTemplateVars(ctx),
    control.id,
    control.managed,
  );
};
