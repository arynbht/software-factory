import type { Control } from "@arynbht/factory-catalog";

import type { AuditContext } from "../context.js";
import { runTool, splitArgs, ToolNotFoundError } from "../detectors/exec.js";
import { detectStacks, templateStacks } from "../stack.js";
import type { Change, Generator } from "./types.js";

/**
 * Generator for controls with `fix: { type: command, run | byStack }`. Emits an
 * effect that runs the command in the repo root on `--write` only; the dry-run
 * shows the exact command so a human reviews it first. A `byStack` entry for the
 * repo's first detected stack wins over `run`; with neither, there is nothing to
 * run. A missing tool or non-zero exit is recorded as a failure (not thrown), so
 * one bad installer never aborts the fix run.
 */
export const commandGenerator: Generator = async (
  ctx: AuditContext,
  control: Control,
): Promise<Change[]> => {
  if (control.fix?.type !== "command") return [];
  const { byStack, run } = control.fix;
  let resolved = run;
  if (byStack) {
    const stack = templateStacks(await detectStacks(ctx)).find(
      (s) => byStack[s] !== undefined,
    );
    if (stack) resolved = byStack[stack];
  }
  if (resolved === undefined) return [];
  const cmd = resolved;
  return [
    {
      type: "effect",
      controlId: control.id,
      summary: `run: ${cmd}`,
      run: async () => {
        const [bin, ...args] = splitArgs(cmd);
        if (!bin) throw new Error("empty command");
        try {
          const result = await runTool(bin, args, ctx.repoPath);
          if (result.exitCode !== 0) {
            throw new Error(`"${cmd}" exited with code ${result.exitCode}`);
          }
        } catch (err) {
          if (err instanceof ToolNotFoundError) {
            throw new Error(`"${bin}" is not installed`);
          }
          throw err;
        }
      },
    },
  ];
};
