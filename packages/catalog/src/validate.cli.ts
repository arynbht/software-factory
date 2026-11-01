// `catalog:validate` entrypoint. Loads every control and gate under
// packages/catalog and exits non-zero if any fails the schema. Run via
// `pnpm catalog:validate`.
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CatalogError, loadCatalog } from "./validate.js";
import { loadGates } from "./gates.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { controls, errors: controlErrors } = await loadCatalog(
  resolve(root, "controls"),
);
const { gates, errors: gateErrors } = await loadGates(resolve(root, "gates"));

const errors: CatalogError[] = [...controlErrors, ...gateErrors];

if (errors.length > 0) {
  console.error(`✖ ${errors.length} catalog error(s):\n`);
  for (const err of errors) {
    console.error(`  ${relative(process.cwd(), err.file)}\n    ${err.message}`);
  }
  process.exit(1);
}

console.log(
  `✓ ${controls.length} control(s) and ${gates.length} gate(s) valid`,
);
