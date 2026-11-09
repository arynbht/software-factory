import type { Control } from "@arynbht/factory-catalog";
import picomatch from "picomatch";

import type { AuditContext } from "../context.js";
import { generators } from "./registry.js";
import type { Change } from "./types.js";

/** A generator that threw while planning a control's fix. */
export interface GeneratorError {
  controlId: string;
  fixType: string;
  message: string;
}

/** The planned changes plus any generator failures, so neither is lost. */
export interface PlanResult {
  changes: Change[];
  errors: GeneratorError[];
}

/** Produce the changes that would fix one control (empty if it has no generator). */
export async function planControl(
  ctx: AuditContext,
  control: Control,
): Promise<PlanResult> {
  if (!control.fix) return { changes: [], errors: [] };
  const generator = generators[control.fix.type];
  if (!generator) return { changes: [], errors: [] };
  try {
    return { changes: await generator(ctx, control), errors: [] };
  } catch (err) {
    // A failing generator must not abort the whole fix run — but it must not be
    // silently dropped either, or the user sees "nothing to fix" when the real
    // story is "a generator is broken". Collect it so callers can surface it.
    return {
      changes: [],
      errors: [
        {
          controlId: control.id,
          fixType: control.fix.type,
          message: (err as Error).message,
        },
      ],
    };
  }
}

// Fixes that create files plan first, so merges in the same run see them (a
// template's ci.yml, then the steps merged into it) and one run converges.
const FIX_ORDER: Record<string, number> = {
  template: 0,
  "merge-json": 1,
  "merge-yaml": 1,
  command: 2,
  "github-setting": 3,
  claude: 4,
};

/**
 * Collect the changes (and generator errors) for a list of controls.
 *
 * Controls are planned against an overlay of the changes planned before them:
 * every generator reads files through `readFile`/`glob`, so without the overlay
 * two merges into the same file would each start from the on-disk original and
 * the last one would silently win. File changes for the same path therefore come
 * out cumulative — applying them in order leaves every control's edit in place,
 * and each one can still be committed on its own.
 */
export async function planControls(
  ctx: AuditContext,
  controls: Control[],
): Promise<PlanResult> {
  const ordered = [...controls].sort(
    (a, b) =>
      (FIX_ORDER[a.fix?.type ?? ""] ?? 9) - (FIX_ORDER[b.fix?.type ?? ""] ?? 9),
  );

  const pending = new Map<string, string>();
  const overlay = withPendingFiles(ctx, pending);
  const changes: Change[] = [];
  const errors: GeneratorError[] = [];

  for (const control of ordered) {
    const result = await planControl(overlay, control);
    for (const change of result.changes) {
      if (change.type !== "file" || change.op === "suggest") continue;
      // A `create` over a file a human already has is skipped at apply time, so
      // later generators must keep seeing the human's file, not ours.
      if (
        change.op === "create" &&
        !pending.has(change.path) &&
        (await ctx.readFile(change.path)) !== null
      ) {
        continue;
      }
      pending.set(change.path, change.contents);
    }
    changes.push(...result.changes);
    errors.push(...result.errors);
  }
  return { changes, errors };
}

/** A context whose reads and globs also see files planned earlier in the run. */
function withPendingFiles(
  ctx: AuditContext,
  pending: ReadonlyMap<string, string>,
): AuditContext {
  return {
    ...ctx,
    async glob(pattern) {
      const found = await ctx.glob(pattern);
      if (pending.size === 0) return found;
      const isMatch = picomatch(pattern, { dot: true });
      const extra = [...pending.keys()].filter(
        (p) => isMatch(p) && !found.includes(p),
      );
      return [...found, ...extra];
    },
    async readFile(relPath) {
      const key = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
      return pending.get(key) ?? ctx.readFile(relPath);
    },
  };
}
