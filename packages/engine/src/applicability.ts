import {
  type Control,
  PHASES,
  type Predicate,
  type Profile,
} from "@arynbht/factory-catalog";

const PHASE_ORDER = new Map(PHASES.map((p) => [p.key, p.order]));

/**
 * Whether a control applies to a profile. A control applies when: its lane is not
 * toggled off, and either it has no `applies` predicate or the predicate holds.
 * With no profile at all, every control applies.
 */
export function appliesTo(control: Control, profile: Profile | null): boolean {
  if (!profile) return true;
  if (profile.lanes && profile.lanes[control.lane] === false) return false;
  if (!control.applies) return true;
  return evaluatePredicate(control.applies, profile);
}

/** Evaluate an applicability predicate against a profile. Keys AND together. */
export function evaluatePredicate(pred: Predicate, profile: Profile): boolean {
  const conditions: boolean[] = [];

  if (pred.all) {
    conditions.push(pred.all.every((p) => evaluatePredicate(p, profile)));
  }
  if (pred.any) {
    conditions.push(pred.any.some((p) => evaluatePredicate(p, profile)));
  }
  if (pred.not) {
    conditions.push(!evaluatePredicate(pred.not, profile));
  }
  if (pred.flag !== undefined) {
    conditions.push(profile.flags[pred.flag] === true);
  }
  if (pred.type !== undefined) {
    conditions.push(profile.type === pred.type);
  }
  if (pred.stack !== undefined) {
    conditions.push(profile.stack.includes(pred.stack));
  }
  if (pred["phase-at-least"] !== undefined) {
    const need = PHASE_ORDER.get(pred["phase-at-least"]) ?? Infinity;
    const have = profile.phase ? (PHASE_ORDER.get(profile.phase) ?? 0) : 0;
    conditions.push(have >= need);
  }

  // An empty predicate is vacuously true; otherwise all present keys must hold.
  return conditions.every(Boolean);
}
