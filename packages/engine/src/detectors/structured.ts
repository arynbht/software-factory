import type { AuditContext } from "../context.js";
import { deepEqual, getByPath } from "./path.js";
import type { DetectorResult } from "./types.js";
import { splitGlobs } from "./util.js";

export interface StructuredPathConfig {
  file: string;
  path: string;
  equals?: unknown;
  exists?: boolean | undefined;
}

/**
 * Shared core for `file-json-path` and `file-yaml-path`. Finds files matching
 * `config.file`, parses each with `parse`, and checks `config.path`:
 *   - with `equals`: passes if any file's value at `path` deep-equals it;
 *   - with `exists: false`: passes only if NO parsed file has a value at `path`
 *     (assert-absent); any file that has it fails;
 *   - otherwise (`exists: true` or omitted): passes if any file has a value at
 *     `path`.
 *
 * No matching file → fail. A readable file exists but the assertion is false →
 * fail. No file could be parsed → skip (undetermined).
 */
export async function checkStructuredPath(
  ctx: AuditContext,
  config: StructuredPathConfig,
  parse: (content: string) => unknown,
  label: string,
): Promise<DetectorResult> {
  const files = await ctx.glob(splitGlobs(config.file));
  if (files.length === 0) {
    return {
      status: "fail",
      message: `no ${label} file matching "${config.file}"`,
      remediation: `create ${config.file}`,
    };
  }

  const failures: string[] = [];
  let parsedAny = false;

  for (const rel of files) {
    const content = await ctx.readFile(rel);
    if (content === null) continue;

    let data: unknown;
    try {
      data = parse(content);
      parsedAny = true;
    } catch {
      failures.push(`${rel}: ${label} parse error`);
      continue;
    }

    const { found, value } = getByPath(data, config.path);

    if (config.equals !== undefined) {
      if (found && deepEqual(value, config.equals)) {
        return {
          status: "pass",
          message: `${rel}: ${config.path} == ${JSON.stringify(config.equals)}`,
        };
      }
      failures.push(
        found
          ? `${rel}: ${config.path} is ${JSON.stringify(value)}`
          : `${rel}: ${config.path} missing`,
      );
    } else if (config.exists === false) {
      // Assert-absent: the first file that has the path fails immediately.
      if (found) {
        return {
          status: "fail",
          message: `${rel}: ${config.path} present but expected absent`,
          remediation: `remove ${config.path} from ${config.file}`,
        };
      }
    } else {
      if (found) {
        return { status: "pass", message: `${rel}: ${config.path} present` };
      }
      failures.push(`${rel}: ${config.path} missing`);
    }
  }

  if (!parsedAny) {
    return {
      status: "skip",
      message: `could not parse any ${label} file matching "${config.file}"`,
    };
  }

  // Assert-absent passes only after every parsed file was checked clean.
  if (config.equals === undefined && config.exists === false) {
    return {
      status: "pass",
      message: `${config.path} absent in ${label} file(s) matching "${config.file}"`,
    };
  }

  const expectation =
    config.equals !== undefined
      ? `${config.path} == ${JSON.stringify(config.equals)}`
      : `${config.path} to exist`;
  return {
    status: "fail",
    message: `expected ${expectation} (${failures.join("; ")})`,
    remediation: `set ${config.path} in ${config.file}`,
  };
}
