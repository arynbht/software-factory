import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve a bare command name to a concrete file on Windows, honouring PATHEXT so
 * `.cmd`/`.bat` shims (e.g. `npm`) are found. `execFile` on Windows can't launch a
 * `.cmd` directly, so we need both this lookup (to tell "missing" from "failed")
 * and a shell to actually run it. Returns the resolved path, or null if not found.
 */
async function resolveOnWindows(binary: string): Promise<string | null> {
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const hasExt = exts.some((e) =>
    binary.toLowerCase().endsWith(e.toLowerCase()),
  );
  const candidates = hasExt
    ? [binary]
    : [binary, ...exts.map((e) => binary + e)];

  const dirs = isAbsolute(binary)
    ? [""]
    : [process.cwd(), ...(process.env.PATH ?? "").split(delimiter)].filter(
        Boolean,
      );

  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = dir ? join(dir, cand) : cand;
      try {
        await access(full, constants.F_OK);
        return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

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
  const windows = process.platform === "win32";
  // On Windows, pre-resolve the binary so a missing tool is still a clean
  // ToolNotFoundError (shell mode would otherwise surface it as a non-zero exit),
  // and so `.cmd` shims like npm can be launched via the shell.
  if (windows) {
    const resolved = await resolveOnWindows(binary);
    if (!resolved) throw new ToolNotFoundError(binary);
  }
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      // Catalog commands are trusted (authored in-repo); a shell on Windows lets
      // cmd.exe resolve .cmd/.bat shims that execFile cannot launch directly.
      shell: windows,
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
