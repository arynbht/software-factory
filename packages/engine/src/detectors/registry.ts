import type { DetectorType } from "@arynbht/factory-catalog";

import { command } from "./command.js";
import { fileExists } from "./file-exists.js";
import { fileJsonPath } from "./file-json-path.js";
import { fileMatches } from "./file-matches.js";
import { fileYamlPath } from "./file-yaml-path.js";
import { githubApi } from "./github-api.js";
import { coverageDetector } from "../quality.js";
import { reviewed } from "./reviewed.js";
import { scorecard } from "./scorecard.js";
import type { DetectorFn } from "./types.js";

/**
 * Maps a detector type to its implementation. Partial while types are still being
 * implemented across M1 — an unmapped type is reported as `skip` by runDetector.
 * The per-detector casts are safe: runDetector only ever calls a function with a
 * config whose `type` matches the key it was looked up under.
 */
export const registry: Partial<Record<DetectorType, DetectorFn>> = {
  "file-exists": fileExists as DetectorFn,
  "file-matches": fileMatches as DetectorFn,
  "file-json-path": fileJsonPath as DetectorFn,
  "file-yaml-path": fileYamlPath as DetectorFn,
  "github-api": githubApi as DetectorFn,
  command: command as DetectorFn,
  scorecard: scorecard as DetectorFn,
  reviewed: reviewed as DetectorFn,
  coverage: coverageDetector as DetectorFn,
};
