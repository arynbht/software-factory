import { fileURLToPath } from "node:url";

import { loadCatalog, type LoadResult } from "./validate.js";

/** Absolute path to the YAML controls shipped with this package. */
export function bundledControlsDir(): string {
  return fileURLToPath(new URL("../controls", import.meta.url));
}

/** Load and validate the controls shipped with this package. */
export function loadBundledCatalog(): Promise<LoadResult> {
  return loadCatalog(bundledControlsDir());
}
