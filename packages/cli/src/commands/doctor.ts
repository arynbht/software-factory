import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import { resolveRepoSlug, githubToken, runTool } from "@arynbht/factory-engine";
import { skillsStatus } from "@arynbht/factory-registry";

import { guardSelfTest } from "./hook.js";

export interface DoctorCheck {
  name: string;
  /** `fail` stops a task from starting; `warn` limits what it can do. */
  status: "ok" | "warn" | "fail";
  detail: string;
}

const exists = (path: string) =>
  access(path)
    .then(() => true)
    .catch(() => false);

/**
 * Run the guard the way Claude Code does, through a shell, on a `.factory/**`
 * edit: true when it ran and refused it. `factory` missing from that shell's
 * PATH is the case this catches.
 */
function guardRunsInShell(root: string): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn("factory hook guard", {
      cwd: root,
      shell: true,
      stdio: ["pipe", "ignore", "pipe"],
      timeout: 30_000,
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", () => done(false));
    // A shell that exits before reading its input mustn't crash doctor.
    child.stdin.on("error", () => undefined);
    child.on("close", (code) =>
      done(code === 2 && stderr.startsWith("factory: ")),
    );
    child.stdin.end(
      JSON.stringify({
        cwd: root,
        tool_input: { file_path: join(root, ".factory", "profile.yml") },
      }),
    );
  });
}

/**
 * The machine and the repo, checked before a task starts (§3.0): a git repo
 * with a factory profile, its guard hook live, the Claude CLI the agent runs
 * on, a way to reach GitHub for ship and close, and skills that match their
 * lock.
 */
export async function doctorChecks(
  root: string,
  options: {
    token?: string | null;
    claude?: () => Promise<string>;
    guardInShell?: (root: string) => Promise<boolean>;
  } = {},
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const isRepo = await runTool("git", ["rev-parse", "--git-dir"], root)
    .then((r) => r.exitCode === 0)
    .catch(() => false);
  checks.push(
    isRepo
      ? { name: "git", status: "ok", detail: "a git repository" }
      : { name: "git", status: "fail", detail: "not a git repository" },
  );

  const profile = await exists(join(root, ".factory", "profile.yml"));
  checks.push(
    profile
      ? { name: "profile", status: "ok", detail: ".factory/profile.yml" }
      : {
          name: "profile",
          status: "fail",
          detail: "no .factory/profile.yml: run `factory init`",
        },
  );

  if (profile) {
    const guard = await guardSelfTest(root);
    const live =
      guard.ok && (await (options.guardInShell ?? guardRunsInShell)(root));
    checks.push(
      live
        ? { name: "hooks", status: "ok", detail: guard.detail }
        : {
            name: "hooks",
            status: "fail",
            detail: guard.ok
              ? "`factory hook guard` can't run from a shell here (is the factory CLI on PATH?), so the guard blocks every edit and command"
              : guard.detail,
          },
    );
  }

  const version = await (
    options.claude ??
    (async () => {
      const res = await runTool("claude", ["--version"], root, {
        timeoutMs: 30_000,
      });
      if (res.exitCode !== 0) throw new Error(res.stderr.trim());
      return res.stdout.trim();
    })
  )().catch(() => null);
  checks.push(
    version
      ? { name: "claude", status: "ok", detail: version }
      : {
          name: "claude",
          status: "fail",
          detail:
            "the `claude` CLI isn't on PATH; the agent and the judge run on it",
        },
  );

  const slug = isRepo ? await resolveRepoSlug(root) : null;
  const auth =
    options.token === undefined
      ? slug
        ? await githubToken(root)
        : null
      : options.token
        ? { token: options.token, source: "explicit" as const }
        : null;
  checks.push(
    slug && auth
      ? {
          name: "github",
          status: "ok",
          detail:
            auth.source === "app"
              ? `${slug.owner}/${slug.repo}, as the factory's App`
              : `${slug.owner}/${slug.repo}, as you (${auth.source} token); with the factory's App, reviews and evidence come from the factory: \`factory app status\``,
        }
      : {
          name: "github",
          status: "warn",
          detail: slug
            ? "no way to reach GitHub (the factory's App, GITHUB_TOKEN or `gh auth login`): ship and close can't run"
            : "no GitHub origin remote: ship and close can't run",
        },
  );

  const problems = isRepo
    ? await skillsStatus(root).catch((err: Error) => [err.message])
    : [];
  const locked = await exists(join(root, ".factory", "skills.lock"));
  checks.push(
    problems.length > 0
      ? { name: "skills", status: "fail", detail: problems.join("; ") }
      : locked
        ? {
            name: "skills",
            status: "ok",
            detail: "installed skills match the lock",
          }
        : {
            name: "skills",
            status: "warn",
            detail:
              "no .factory/skills.lock: tasks run on the spine alone (`factory skills init`, then `factory skills sync`)",
          },
  );
  return checks;
}

/** `factory doctor`: exit 1 when anything a task needs is missing. */
export async function runDoctor(path: string): Promise<number> {
  const checks = await doctorChecks(resolve(path));
  const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
  for (const c of checks)
    process.stdout.write(`${mark[c.status]} ${c.name.padEnd(8)} ${c.detail}\n`);
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}
