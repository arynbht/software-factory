import type { DetectorConfig } from "@arynbht/factory-catalog";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";

import type { AuditContext } from "../context.js";
import { checkStructuredPath } from "./structured.js";
import type { DetectorResult } from "./types.js";

type FileJsonPathConfig = Extract<DetectorConfig, { type: "file-json-path" }>;

/** Parse JSON with comments / trailing commas (tsconfig.json, .vscode, etc.). */
function parseJson(content: string): unknown {
  const errors: ParseError[] = [];
  const data: unknown = parseJsonc(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error("invalid JSON");
  }
  return data;
}

/** Asserts a path exists (or equals a value) inside a JSON/JSONC file. */
export function fileJsonPath(
  ctx: AuditContext,
  config: FileJsonPathConfig,
): Promise<DetectorResult> {
  return checkStructuredPath(ctx, config, parseJson, "JSON");
}
