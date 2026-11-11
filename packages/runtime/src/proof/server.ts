// Start the app for UI proof: the profile's `proof.start` command, in a
// checkout, on a given port, with the allowlisted environment (it's the repo's
// code). Resolves once its URL answers; `stop()` kills the whole process tree.
import { spawn } from "node:child_process";

import { allowlistedEnv } from "@arynbht/factory-engine";

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

export async function startServer(options: {
  command: string;
  cwd: string;
  port: number;
  /** `{port}` is replaced. Default http://localhost:{port}. */
  url?: string | undefined;
  timeoutMs?: number | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}): Promise<RunningServer> {
  const url = (options.url ?? "http://localhost:{port}").replace(
    /\{port\}/g,
    String(options.port),
  );
  const timeoutMs = options.timeoutMs ?? 90_000;
  // Something already answering would pass the readiness check for the app.
  if (
    await fetch(url, { signal: AbortSignal.timeout(1000) }).then(
      () => true,
      () => false,
    )
  ) {
    throw new ServerError(
      `${url} already answers before \`${options.command}\` started: port ${options.port} is in use`,
    );
  }
  const posix = process.platform !== "win32";
  const child = spawn(options.command, {
    cwd: options.cwd,
    shell: true,
    // Its own process group on POSIX, so stop() reaches the dev server the
    // shell started, not just the shell.
    detached: posix,
    windowsHide: true,
    env: {
      ...allowlistedEnv(),
      ...options.env,
      PORT: String(options.port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const keep = (d: Buffer) => {
    output = `${output}${d.toString()}`.slice(-2000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited: number | null | undefined;
  child.on("exit", (code) => {
    exited = code;
  });
  child.on("error", (err) => {
    output = `${output}\n${err.message}`;
    exited = null;
  });

  const stop = async (): Promise<void> => {
    if (exited !== undefined || child.pid === undefined) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      try {
        if (posix) process.kill(-child.pid!, "SIGTERM");
        else
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
          });
      } catch {
        resolve();
      }
      setTimeout(resolve, 5000).unref();
    });
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== undefined) {
      throw new ServerError(
        `\`${options.command}\` exited (${exited}) before ${url} answered:\n${output.trim()}`,
      );
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return { url, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  await stop();
  throw new ServerError(
    `${url} didn't answer within ${Math.round(timeoutMs / 1000)}s of \`${options.command}\`:\n${output.trim()}`,
  );
}
