// Loader for gate definitions, mirroring the control loader.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { type Gate, GateSchema } from "./gate.js";
import type { CatalogError } from "./validate.js";

export interface GateLoadResult {
  gates: Gate[];
  errors: CatalogError[];
}

/** Load and validate every gate YAML under `dir` (missing dir → none). */
export async function loadGates(dir: string): Promise<GateLoadResult> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { gates: [], errors: [] };
    }
    throw err;
  }

  const files = entries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => join(dir, e.name))
    .sort();

  const gates: Gate[] = [];
  const errors: CatalogError[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    let doc: unknown;
    try {
      doc = parseYaml(await readFile(file, "utf8"));
    } catch (err) {
      errors.push({
        file,
        message: `YAML parse error: ${(err as Error).message}`,
      });
      continue;
    }
    const result = GateSchema.safeParse(doc);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          file,
          message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        });
      }
      continue;
    }
    const prev = seen.get(result.data.phase);
    if (prev) {
      errors.push({
        file,
        message: `duplicate gate for phase "${result.data.phase}" (also in ${prev})`,
      });
      continue;
    }
    seen.set(result.data.phase, file);
    gates.push(result.data);
  }

  return { gates, errors };
}
