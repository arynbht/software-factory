// Generates the JSON Schema for a control (for editor autocomplete on YAML files).
// Run via `pnpm schema:json`; the output is committed at schema/control.schema.json.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ControlObjectSchema } from "./schema.js";

const jsonSchema = z.toJSONSchema(ControlObjectSchema, {
  target: "draft-2020-12",
  unrepresentable: "any",
});

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "schema", "control.schema.json");

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");

console.log(`wrote ${outPath}`);
