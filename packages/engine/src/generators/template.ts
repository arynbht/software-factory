import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { Control, Profile } from "@arynbht/factory-catalog";
import { bundledTemplatesDir } from "@arynbht/factory-catalog";
import { Eta } from "eta";

import type { AuditContext } from "../context.js";
import type { Change, Generator } from "./types.js";

const eta = new Eta({ autoEscape: false });

export interface TemplateVars {
  name: string;
  owner: string;
  year: number;
  type: string;
  stack: string[];
  license: string;
  flags: Record<string, boolean>;
}

/** Build template variables from the profile (with sensible fallbacks). */
export function templateVars(
  profile: Profile | null,
  year: number,
): TemplateVars {
  return {
    name: profile?.name ?? "project",
    owner: profile?.name ?? "the authors",
    year,
    type: profile?.type ?? "library",
    stack: profile?.stack ?? [],
    license: "MIT",
    flags: (profile?.flags as Record<string, boolean>) ?? {},
  };
}

/** The stack bucket to select stack-specific template files from. */
export function pickStack(stack: string[]): "node" | "python" {
  return stack.some((s) => /python|pytest|django|flask|fastapi/i.test(s))
    ? "python"
    : "node";
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/**
 * Render a template directory into file changes. Files at the template root are
 * stack-agnostic; files under `common/` are always included; files under `node/`
 * or `python/` are included only for the matching stack. A `.eta` extension is
 * rendered with the profile vars and stripped; other files are copied verbatim.
 */
export async function renderTemplate(
  templateName: string,
  vars: TemplateVars,
  controlId: string,
): Promise<Change[]> {
  const base = resolve(bundledTemplatesDir(), templateName);
  const stack = pickStack(vars.stack);
  const files = await walk(base);
  const changes: Change[] = [];

  for (const file of files) {
    const rel = relative(base, file).split(sep).join("/");
    const [first, ...rest] = rel.split("/");
    let outRel: string;
    if (first === "node" || first === "python" || first === "common") {
      if (first !== "common" && first !== stack) continue;
      outRel = rest.join("/");
    } else {
      outRel = rel;
    }

    const raw = await readFile(file, "utf8");
    const contents = outRel.endsWith(".eta")
      ? eta.renderString(raw, vars)
      : raw;
    changes.push({
      type: "file",
      controlId,
      path: outRel.replace(/\.eta$/, ""),
      contents,
      op: "create",
    });
  }
  return changes;
}

/** Generator for controls with `fix: { type: template, template: <name> }`. */
export const templateGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "template") return [];
  const profile = await ctx.profile().catch(() => null);
  return renderTemplate(
    control.fix.template,
    templateVars(profile, ctx.now.getFullYear()),
    control.id,
  );
};
