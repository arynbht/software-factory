// `catalog:validate` entrypoint. Loads every control under packages/catalog/controls
// and exits non-zero if any fails the schema. Run via `pnpm catalog:validate`.
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "./validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const controlsDir = resolve(here, "..", "controls");

const { controls, errors } = await loadCatalog(controlsDir);

if (errors.length > 0) {
  console.error(`✖ ${errors.length} catalog error(s):\n`);
  for (const err of errors) {
    console.error(`  ${relative(process.cwd(), err.file)}\n    ${err.message}`);
  }
  process.exit(1);
}

console.log(`✓ ${controls.length} control(s) valid`);
