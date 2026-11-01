import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Thrown when the requested binary is not on PATH (→ detector skip). */
export class ToolNotFoundError extends Error {
  constructor(public readonly binary: string) {
    super(`tool not found: ${binary}`);
    this.name = "ToolNotFoundError";
  }
}

export interface ToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Split a command line into tokens on whitespace. Good enough for the simple
 * tool invocations controls use (e.g. `scorecard --format json`); it does not
 * honour shell quoting, so avoid arguments containing spaces.
 */
export function splitArgs(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

/**
 * Run a binary (no shell) in `cwd`, capturing output and exit code. A missing
 * binary raises {@link ToolNotFoundError}; a non-zero exit is returned normally
 * so callers can compare it to an expected code.
 */
export async function runTool(
  binary: string,
  args: string[],
  cwd: string,
): Promise<ToolResult> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { exitCode: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    if (e.code === "ENOENT") throw new ToolNotFoundError(binary);
    if (typeof e.code === "number") {
      return {
        exitCode: e.code,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
    throw err;
  }
}
