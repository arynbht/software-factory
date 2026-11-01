import { fileURLToPath } from "node:url";

import { type GateLoadResult, loadGates } from "./gates.js";
import { loadCatalog, type LoadResult } from "./validate.js";

/** Absolute path to the YAML controls shipped with this package. */
export function bundledControlsDir(): string {
  return fileURLToPath(new URL("../controls", import.meta.url));
}

/** Load and validate the controls shipped with this package. */
export function loadBundledCatalog(): Promise<LoadResult> {
  return loadCatalog(bundledControlsDir());
}

/** Absolute path to the YAML gates shipped with this package. */
export function bundledGatesDir(): string {
  return fileURLToPath(new URL("../gates", import.meta.url));
}

/** Absolute path to the generator templates shipped with this package. */
export function bundledTemplatesDir(): string {
  return fileURLToPath(new URL("../templates", import.meta.url));
}

/** Load and validate the gates shipped with this package. */
export function loadBundledGates(): Promise<GateLoadResult> {
  return loadGates(bundledGatesDir());
}
