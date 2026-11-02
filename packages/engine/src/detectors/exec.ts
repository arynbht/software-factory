import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve a bare command name to a concrete file on Windows, honouring PATHEXT so
 * `.cmd`/`.bat` shims (e.g. `npm`) are found. `execFile` on Windows can't launch a
 * `.cmd` directly, so we resolve the real file here (to tell "missing" from
 * "failed" and to decide whether a `cmd.exe` wrapper is needed). Returns the
 * resolved path, or null if not found.
 */
export async function resolveOnWindows(binary: string): Promise<string | null> {
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const hasExt = exts.some((e) =>
    binary.toLowerCase().endsWith(e.toLowerCase()),
  );
  // On Windows only a file with an executable extension can be launched; a bare
  // name (e.g. an extensionless `npm` bash shim that coexists with `npm.cmd`) is
  // not runnable, so when the name has no extension we consider PATHEXT variants
  // only — mirroring how cmd.exe resolves a command.
  const candidates = hasExt ? [binary] : exts.map((e) => binary + e);

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
 *
 * On Windows the binary is resolved via PATH+PATHEXT first (so a missing tool is a
 * clean ToolNotFoundError). A `.cmd`/`.bat` shim — which `execFile` cannot launch
 * directly — is run through `cmd.exe /d /s /c`; everything else runs directly.
 * Crucially we never pass `shell: true`, so Node applies its own argument quoting
 * and a path containing spaces (e.g. `C:\…\Software Factory - Dev`) is passed as a
 * single argument rather than split.
 */
export async function runTool(
  binary: string,
  args: string[],
  cwd: string,
): Promise<ToolResult> {
  let file = binary;
  let argv = args;

  if (process.platform === "win32") {
    const resolved = await resolveOnWindows(binary);
    if (!resolved) throw new ToolNotFoundError(binary);
    if (/\.(cmd|bat)$/i.test(resolved)) {
      file = "cmd.exe";
      argv = ["/d", "/s", "/c", resolved, ...args];
    } else {
      file = resolved;
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(file, argv, {
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
