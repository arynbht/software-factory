import type { FixConfig } from "@arynbht/factory-catalog";

import { claudeGenerator } from "./claude.js";
import { commandGenerator } from "./command.js";
import { githubSettingGenerator } from "./github-setting.js";
import { mergeJsonGenerator } from "./merge-json.js";
import { mergeYamlGenerator } from "./merge-yaml.js";
import { templateGenerator } from "./template.js";
import type { Generator } from "./types.js";

type FixType = FixConfig["type"];

/**
 * Maps a control's fix type to its generator. An unmapped type (or a control with no
 * `fix`) simply produces no changes.
 */
export const generators: Partial<Record<FixType, Generator>> = {
  template: templateGenerator,
  "merge-json": mergeJsonGenerator,
  "merge-yaml": mergeYamlGenerator,
  "github-setting": githubSettingGenerator,
  command: commandGenerator,
  claude: claudeGenerator,
};
