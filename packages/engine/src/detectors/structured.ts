import type { AuditContext } from "../context.js";
import { collectByPath, deepEqual } from "./path.js";
import type { DetectorResult } from "./types.js";
import { compileRegex, splitGlobs } from "./util.js";

export interface StructuredPathConfig {
  file: string;
  path: string;
  equals?: unknown;
  exists?: boolean | undefined;
  /** Regex each inspected value (as a string) is tested against. */
  matches?: string | undefined;
  /** With `matches`/`min`: every value must satisfy (default: any one). */
  all?: boolean | undefined;
  /** Minimum for numeric values (e.g. a coverage percentage). */
  min?: number | undefined;
  /** Glob of files that never count (e.g. the factory's own workflow). */
  exclude?: string | undefined;
}

/**
 * Shared core for `file-json-path` and `file-yaml-path`. Finds files matching
 * `config.file` (minus `exclude`), parses each with `parse`, and checks the
 * values at `config.path`, which may contain `*` wildcards
 * (`jobs.*.steps[*].uses`):
 *   - with `matches` and/or `min`: a value check. By default passes if any value
 *     in any file satisfies it; with `all`, every value found must (and at least
 *     one must exist) — "every action is SHA-pinned";
 *   - with `equals`: passes if any value deep-equals it;
 *   - with `exists: false`: passes only if NO parsed file has a value at `path`;
 *   - otherwise: passes if any file has a value at `path` (with `all`: every file).
 *
 * No matching file → fail. No file could be parsed → skip (undetermined).
 */
export async function checkStructuredPath(
  ctx: AuditContext,
  config: StructuredPathConfig,
  parse: (content: string) => unknown,
  label: string,
): Promise<DetectorResult> {
  let files = await ctx.glob(splitGlobs(config.file));
  if (config.exclude) {
    const excluded = new Set(await ctx.glob(splitGlobs(config.exclude)));
    files = files.filter((f) => !excluded.has(f));
  }
  if (files.length === 0) {
    return {
      status: "fail",
      message: `no ${label} file matching "${config.file}"`,
      remediation: `create ${config.file}`,
    };
  }

  const valueCheck = config.matches !== undefined || config.min !== undefined;
  let regex: RegExp | undefined;
  try {
    regex = config.matches ? compileRegex(config.matches) : undefined;
  } catch {
    return { status: "skip", message: `invalid regex: ${config.matches}` };
  }
  const satisfies = (value: unknown): boolean => {
    // Non-string values (an `on:` map, a `permissions:` object) are tested in
    // their JSON form, so `pull_request` matches `on: { pull_request: … }`.
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (regex && !regex.test(text)) return false;
    if (config.min !== undefined) {
      return typeof value === "number" && value >= config.min;
    }
    return true;
  };

  const failures: string[] = [];
  const offending: string[] = [];
  let parsedAny = false;
  let valuesSeen = 0;

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

    const values = collectByPath(data, config.path);
    const found = values.length > 0;

    if (valueCheck) {
      valuesSeen += values.length;
      for (const value of values) {
        if (satisfies(value)) {
          if (!config.all) {
            return {
              status: "pass",
              message: `${rel}: ${config.path} = ${JSON.stringify(value)}`,
            };
          }
        } else {
          offending.push(`${rel}: ${JSON.stringify(value)}`);
        }
      }
    } else if (config.equals !== undefined) {
      if (values.some((v) => deepEqual(v, config.equals))) {
        return {
          status: "pass",
          message: `${rel}: ${config.path} == ${JSON.stringify(config.equals)}`,
        };
      }
      failures.push(
        found
          ? `${rel}: ${config.path} is ${JSON.stringify(values[0])}`
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
    } else if (config.all) {
      // Exists in every file: the first file without it fails.
      if (!found) {
        return {
          status: "fail",
          message: `${rel}: ${config.path} missing`,
          remediation: `set ${config.path} in every file matching ${config.file}`,
        };
      }
    } else {
      if (found) {
        return { status: "pass", message: `${rel}: ${config.path} present` };
      }
      failures.push(`${rel}: ${config.path} missing`);
    }
  }

  if (!valueCheck && config.all && config.equals === undefined && parsedAny) {
    return {
      status: "pass",
      message: `${config.path} present in every ${label} file matching "${config.file}"`,
    };
  }

  if (!parsedAny) {
    return {
      status: "skip",
      message: `could not parse any ${label} file matching "${config.file}"`,
    };
  }

  if (valueCheck) {
    const wanted = [
      config.matches ? `matching /${config.matches}/` : "",
      config.min !== undefined ? `>= ${config.min}` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    if (config.all && valuesSeen > 0 && offending.length === 0) {
      return {
        status: "pass",
        message: `all ${valuesSeen} value(s) at ${config.path} ${wanted}`,
      };
    }
    return {
      status: "fail",
      message:
        valuesSeen === 0
          ? `no value at ${config.path} in ${label} file(s) matching "${config.file}"`
          : `${config.all ? "not every" : "no"} value at ${config.path} is ${wanted}${
              offending.length > 0
                ? ` (${offending.slice(0, 5).join("; ")}${offending.length > 5 ? "; …" : ""})`
                : ""
            }`,
      remediation: `make ${config.path} ${wanted} in ${config.file}`,
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
