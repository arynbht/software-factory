import type { DetectorConfig } from "@arynbht/factory-catalog";
import { parse as parseYaml } from "yaml";

import type { AuditContext } from "../context.js";
import { checkStructuredPath } from "./structured.js";
import type { DetectorResult } from "./types.js";

type FileYamlPathConfig = Extract<DetectorConfig, { type: "file-yaml-path" }>;

/** Asserts a path exists (or equals a value) inside a YAML file. */
export function fileYamlPath(
  ctx: AuditContext,
  config: FileYamlPathConfig,
): Promise<DetectorResult> {
  return checkStructuredPath(
    ctx,
    config,
    (content) => parseYaml(content),
    "YAML",
  );
}
