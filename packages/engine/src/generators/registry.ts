import type { FixConfig } from "@arynbht/factory-catalog";

import { mergeJsonGenerator } from "./merge-json.js";
import { mergeYamlGenerator } from "./merge-yaml.js";
import { templateGenerator } from "./template.js";
import type { Generator } from "./types.js";

type FixType = FixConfig["type"];

/**
 * Maps a control's fix type to its generator. Partial while generators are added
 * across M3; an unmapped type (or a control with no `fix`) simply produces no
 * changes. `claude` is intentionally absent until M4.
 */
export const generators: Partial<Record<FixType, Generator>> = {
  template: templateGenerator,
  "merge-json": mergeJsonGenerator,
  "merge-yaml": mergeYamlGenerator,
};
