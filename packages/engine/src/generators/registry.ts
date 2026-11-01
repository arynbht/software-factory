import type { FixConfig } from "@arynbht/factory-catalog";

import type { Generator } from "./types.js";

type FixType = FixConfig["type"];

/**
 * Maps a control's fix type to its generator. Partial while generators are added
 * across M3; an unmapped type (or a control with no `fix`) simply produces no
 * changes. `claude` is intentionally absent until M4.
 */
export const generators: Partial<Record<FixType, Generator>> = {};
