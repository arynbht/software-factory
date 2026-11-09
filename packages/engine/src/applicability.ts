import {
  type Control,
  PHASES,
  type Predicate,
  type Profile,
} from "@arynbht/factory-catalog";

import type { AuditContext } from "./context.js";
import { splitGlobs } from "./detectors/util.js";
import { detectStacks } from "./stack.js";

const PHASE_ORDER = new Map(PHASES.map((p) => [p.key, p.order]));

/**
 * What the repo itself shows, for predicates that look at the repo rather than
 * the profile: its detected stacks, and which `{ file }` globs matched.
 */
export interface RepoFacts {
  stacks: readonly string[];
  /** The `{ file }` predicate globs (verbatim) that matched at least one file. */
  files: ReadonlySet<string>;
}

export const NO_FACTS: RepoFacts = { stacks: [], files: new Set() };

/** Detect stacks and resolve every `{ file }` glob the controls' predicates use. */
export async function gatherRepoFacts(
  ctx: AuditContext,
  controls: readonly Control[],
): Promise<RepoFacts> {
  const globs = new Set<string>();
  for (const control of controls) {
    if (control.applies) collectFileGlobs(control.applies, globs);
  }
  const files = new Set<string>();
  for (const g of globs) {
    if ((await ctx.glob(splitGlobs(g))).length > 0) files.add(g);
  }
  return { stacks: await detectStacks(ctx), files };
}

/**
 * Whether a control applies. A control applies when: its lane is not toggled off,
 * and either it has no `applies` predicate or the predicate holds.
 *
 * `{ stack }` holds when the profile declares the stack or the repo shows it;
 * `{ file }` holds when a file matches. With no profile, a predicate made only
 * of those repo conditions is still evaluated (a Python repo never gets the
 * TypeScript controls); any other predicate is assumed to hold, since the
 * flags/type/phase it needs are unknown.
 */
export function appliesTo(
  control: Control,
  profile: Profile | null,
  facts: RepoFacts = NO_FACTS,
): boolean {
  if (!profile) {
    if (!control.applies || !onlyRepoConditions(control.applies)) return true;
    return evaluatePredicate(control.applies, null, facts);
  }
  if (profile.lanes && profile.lanes[control.lane] === false) return false;
  if (!control.applies) return true;
  return evaluatePredicate(control.applies, profile, facts);
}

/** Evaluate an applicability predicate. Keys AND together. */
export function evaluatePredicate(
  pred: Predicate,
  profile: Profile | null,
  facts: RepoFacts = NO_FACTS,
): boolean {
  const conditions: boolean[] = [];

  if (pred.all) {
    conditions.push(
      pred.all.every((p) => evaluatePredicate(p, profile, facts)),
    );
  }
  if (pred.any) {
    conditions.push(pred.any.some((p) => evaluatePredicate(p, profile, facts)));
  }
  if (pred.not) {
    conditions.push(!evaluatePredicate(pred.not, profile, facts));
  }
  if (pred.flag !== undefined) {
    conditions.push(profile?.flags[pred.flag] === true);
  }
  if (pred.type !== undefined) {
    conditions.push(profile?.type === pred.type);
  }
  if (pred.stack !== undefined) {
    conditions.push(
      (profile?.stack.includes(pred.stack) ?? false) ||
        facts.stacks.includes(pred.stack),
    );
  }
  if (pred.file !== undefined) {
    conditions.push(facts.files.has(pred.file));
  }
  if (pred["phase-at-least"] !== undefined) {
    const need = PHASE_ORDER.get(pred["phase-at-least"]) ?? Infinity;
    const have = profile?.phase ? (PHASE_ORDER.get(profile.phase) ?? 0) : 0;
    conditions.push(have >= need);
  }

  // An empty predicate is vacuously true; otherwise all present keys must hold.
  return conditions.every(Boolean);
}

function children(pred: Predicate): Predicate[] {
  return [
    ...(pred.all ?? []),
    ...(pred.any ?? []),
    ...(pred.not ? [pred.not] : []),
  ];
}

function collectFileGlobs(pred: Predicate, out: Set<string>): void {
  if (pred.file !== undefined) out.add(pred.file);
  for (const child of children(pred)) collectFileGlobs(child, out);
}

function onlyRepoConditions(pred: Predicate): boolean {
  if (
    pred.flag !== undefined ||
    pred.type !== undefined ||
    pred["phase-at-least"] !== undefined
  ) {
    return false;
  }
  return children(pred).every(onlyRepoConditions);
}
