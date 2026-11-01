// Catalog loader + validator. Reads every YAML control under a directory,
// validates each against the schema, and reports duplicate ids.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { ControlSchema, type Control } from "./schema.js";

export interface CatalogError {
  file: string;
  message: string;
}

export interface LoadResult {
  controls: Control[];
  errors: CatalogError[];
}

/** Recursively collect `*.yml` / `*.yaml` files; a missing dir yields none. */
async function findYamlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findYamlFiles(full)));
    } else if (/\.ya?ml$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Load and validate every control under `dir`. Never throws for bad controls —
 * returns the valid ones plus a list of errors so callers can report all at once.
 */
export async function loadCatalog(dir: string): Promise<LoadResult> {
  const files = await findYamlFiles(dir);
  const controls: Control[] = [];
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

    const result = ControlSchema.safeParse(doc);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".") || "(root)";
        errors.push({ file, message: `${path}: ${issue.message}` });
      }
      continue;
    }

    const control = result.data;
    const prev = seen.get(control.id);
    if (prev) {
      errors.push({
        file,
        message: `duplicate control id "${control.id}" (also defined in ${prev})`,
      });
      continue;
    }
    seen.set(control.id, file);
    controls.push(control);
  }

  return { controls, errors };
}
