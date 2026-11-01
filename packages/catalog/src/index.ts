// @arynbht/factory-catalog
// Control catalog package: the control schema (zod), taxonomy (lanes + phases),
// and the loader/validator. The YAML controls/gates/templates/prompts land here
// across M1-M6.
export const PACKAGE = "@arynbht/factory-catalog" as const;

export * from "./taxonomy.js";
export * from "./schema.js";
export { ProfileSchema, type Profile } from "./profile.js";
export { loadCatalog } from "./validate.js";
export type { CatalogError, LoadResult } from "./validate.js";
export { bundledControlsDir, loadBundledCatalog } from "./bundled.js";
