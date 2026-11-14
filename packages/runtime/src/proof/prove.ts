// The prove beat (§3.5, §9): the proof the assembly names, produced by a tool,
// never described by the agent. UI: the base and the change served side by
// side, shot at three breakpoints, axe on the change, the images on the
// `evidence` branch. Everything else: the test run, with the new tests named.
// The result goes to the ledger and `.factory/tasks/<id>/proof/proof.json`.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  allowlistedEnv,
  buildContext,
  githubToken,
  installDeps,
  Octokit,
  packageManager,
  QUIET_LOG,
  resolveRepoSlug,
  runTool,
} from "@arynbht/factory-engine";
import { simpleGit } from "simple-git";
import { parse } from "yaml";

import { isTestFile } from "../judge/protected.js";
import { parseAddedLines, parseNameStatus } from "../judge/tier1.js";
import { loadIsolation, type Isolation } from "../agent/isolate.js";
import { AssemblySchema, type ProofType } from "../router/route.js";
import {
  loadTask,
  nextStep,
  type Task,
  TaskError,
  TASKS_DIR,
} from "../task/tasks.js";
import { type EvidenceClient, publishEvidence } from "./evidence.js";
import { startServer } from "./server.js";
import { type AxeViolation, shoot, type Shot } from "./shoot.js";

/** The "before" server runs this far above the task's own port. */
const BEFORE_PORT_OFFSET = 1000;

export interface ProofRecord {
  task: string;
  kind: ProofType;
  passed: boolean;
  /** What the ledger says, one line each. */
  lines: string[];
  shots?: (Shot & { side: "before" | "after"; url?: string })[];
  violations?: AxeViolation[];
  tests?: { exitCode: number; added: string[]; output: string };
}

export type Publish = (
  files: readonly string[],
) => Promise<{ file: string; url: string }[] | null>;

export interface ProveOptions {
  by: string;
  now?: Date | undefined;
  /** Upload to the evidence branch; default: GitHub via the token and origin. */
  publish?: Publish | undefined;
}

const tail = (s: string, n = 400) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

/** A detached checkout of `base` with hooks off, for the "before" side. */
async function baseCheckout(repoPath: string, base: string): Promise<string> {
  const git = simpleGit(repoPath);
  const commonDir = (
    await git.raw(["rev-parse", "--path-format=absolute", "--git-common-dir"])
  ).trim();
  const noHooks = join(commonDir, "factory-no-hooks");
  await mkdir(noHooks, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "factory-proof-base-"));
  await simpleGit(repoPath, {
    unsafe: { allowUnsafeHooksPath: true },
    config: [`core.hooksPath=${noHooks}`],
  }).raw(["worktree", "add", "--detach", dir, base]);
  return dir;
}

const TEST_NAME = /\b(?:it|test)(?:\.\w+)?\(\s*(["'`])(.+?)\1/;

/**
 * The tests a change adds, by name (§11: "new tests named"): every `it(…)` or
 * `test(…)` on an added line of a test file, whether the file is new or
 * existed at base. A new test file with no name we can read is listed by path.
 */
export function newTestNames(
  files: readonly { status: string; path: string }[],
  addedLines: Map<string, string[]>,
): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.status === "D" || !isTestFile(f.path)) continue;
    const names = (addedLines.get(f.path) ?? [])
      .map((l) => TEST_NAME.exec(l)?.[2])
      .filter((n): n is string => n !== undefined);
    if (names.length > 0) out.push(...names.map((n) => `${f.path}: ${n}`));
    else if (f.status === "A") out.push(f.path);
  }
  return out;
}

async function testRun(
  isolation: Isolation,
  kind: ProofType,
  publish: Publish,
  proofDir: string,
): Promise<ProofRecord> {
  const dir = isolation.worktree;
  const lines: string[] = [];
  if (kind !== "test-run")
    lines.push(
      `${kind} has no proof runner yet; the test run stands in, and a person attaches the ${kind} proof`,
    );
  const pkg = await readFile(join(dir, "package.json"), "utf8")
    .then((t) => JSON.parse(t) as { scripts?: Record<string, string> })
    .catch(() => null);
  if (!pkg?.scripts?.test) {
    lines.push("tests: no test script to run (fails closed)");
    return { task: isolation.task, kind, passed: false, lines };
  }
  // The change's install or test command failing is a failed proof, not a crash.
  const install = await installDeps(dir);
  if (install.ran && !install.passed) {
    lines.push(`install failed: ${tail(install.output)}`);
    return { task: isolation.task, kind, passed: false, lines };
  }
  const pm = await packageManager(dir);
  let res: Awaited<ReturnType<typeof runTool>>;
  try {
    res = await runTool(pm, ["run", "test"], dir, {
      env: allowlistedEnv(),
      timeoutMs: 600_000,
    });
  } catch (err) {
    lines.push(`tests couldn't run: ${tail((err as Error).message)}`);
    return { task: isolation.task, kind, passed: false, lines };
  }
  const git = simpleGit(dir);
  const added = newTestNames(
    parseNameStatus(
      await git.raw(["diff", "--name-status", "-M", isolation.base, "HEAD"]),
    ),
    parseAddedLines(
      await git.raw(["diff", "-U0", "--no-color", isolation.base, "HEAD"]),
    ),
  );
  const passed = res.exitCode === 0;
  lines.push(
    `tests ${passed ? "passed" : "failed"} (${pm} run test, exit ${res.exitCode}) · new tests: ${added.join("; ") || "none"}`,
    `output: ${tail(`${res.stdout}\n${res.stderr}`)}`,
  );

  // The whole run goes to the evidence branch, beside any screenshots.
  const log = join(proofDir, "test-run.txt");
  await mkdir(proofDir, { recursive: true });
  await writeFile(
    log,
    `${pm} run test · exit ${res.exitCode}\nnew tests:\n${added.map((a) => `  ${a}`).join("\n") || "  none"}\n\n${res.stdout}\n${res.stderr}`,
    "utf8",
  );
  let published: Awaited<ReturnType<Publish>> = null;
  let notPushed = "no GitHub token or origin remote";
  try {
    published = await publish([log]);
  } catch (err) {
    notPushed = `upload failed: ${tail((err as Error).message, 200)}`;
  }
  lines.push(
    published?.[0]
      ? `evidence: the test run on the evidence branch: ${published[0].url}`
      : `evidence: the test run in ${TASKS_DIR}/${isolation.task}/proof/test-run.txt (not pushed: ${notPushed})`,
  );
  return {
    task: isolation.task,
    kind,
    passed,
    lines,
    tests: {
      exitCode: res.exitCode,
      added,
      output: `${res.stdout}\n${res.stderr}`.slice(-4000),
    },
  };
}

async function uiProof(
  repoPath: string,
  task: Task,
  isolation: Isolation,
  publish: Publish,
): Promise<ProofRecord> {
  const profile = await buildContext(repoPath)
    .profile()
    .catch(() => null);
  const start = profile?.proof?.start;
  if (!start)
    throw new TaskError(
      "the UI proof needs to know how to serve the app: set `proof.start` (and `proof.url` if it isn't http://localhost:{port}) in .factory/profile.yml",
    );
  const timeoutMs = (profile?.proof?.ready_timeout ?? 90) * 1000;
  const pages = task.card.pages.length > 0 ? task.card.pages : ["/"];
  const outDir = join(repoPath, TASKS_DIR, task.card.id, "proof");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const shots: NonNullable<ProofRecord["shots"]> = [];
  let violations: AxeViolation[] = [];
  /** Serve one side and shoot it; the server is always stopped. */
  const side = async (which: "before" | "after", dir: string) => {
    const install = await installDeps(dir);
    if (install.ran && !install.passed)
      throw new Error(`install failed: ${tail(install.output, 300)}`);
    const server = await startServer({
      command: start,
      cwd: dir,
      port:
        which === "before"
          ? isolation.port + BEFORE_PORT_OFFSET
          : isolation.port,
      url: profile?.proof?.url,
      timeoutMs,
    });
    try {
      const result = await shoot({
        baseUrl: server.url,
        pages,
        outDir,
        prefix: which,
        axe: which === "after",
      });
      shots.push(...result.shots.map((s) => ({ ...s, side: which })));
      if (which === "after") violations = result.violations;
    } finally {
      await server.stop();
    }
  };

  // The base failing to serve is the setup's problem: throw. The change
  // failing to serve is the change's: a failed proof, sent back to build.
  const before = await baseCheckout(repoPath, isolation.base);
  try {
    await side("before", before);
  } finally {
    await simpleGit(repoPath)
      .raw(["worktree", "remove", "--force", before])
      .catch(() => "");
    // Best-effort: Windows can hold a file open a moment after the server stops.
    await rm(before, { recursive: true, force: true }).catch(() => undefined);
  }
  try {
    await side("after", isolation.worktree);
  } catch (err) {
    return {
      task: task.card.id,
      kind: "ui-screenshots",
      passed: false,
      lines: [`the change didn't serve: ${tail((err as Error).message, 600)}`],
      shots,
    };
  }

  // Evidence that can't be uploaded is still evidence: keep it local, say so.
  let published: Awaited<ReturnType<Publish>> = null;
  let notPushed = "no GitHub token or origin remote";
  try {
    published = await publish(shots.map((s) => s.file));
  } catch (err) {
    notPushed = `upload failed: ${tail((err as Error).message, 200)}`;
  }
  for (const p of published ?? []) {
    const shot = shots.find((s) => s.file === p.file);
    if (shot) shot.url = p.url;
  }
  // A page the change serves as an error isn't a page (a new page can 404 on
  // the base, so only the change's side counts).
  const broken = shots.filter((s) => s.side === "after" && s.status >= 400);
  const passed = violations.length === 0 && broken.length === 0;
  const lines = [
    `screenshots: ${pages.join(", ")} at sm/md/lg, before and after (${shots.length} images) ${
      published
        ? `on the evidence branch: ${task.card.id}/`
        : `in ${TASKS_DIR}/${task.card.id}/proof/ (not pushed: ${notPushed})`
    }`,
    violations.length === 0
      ? "axe: 0 serious or critical violations"
      : `axe: ${violations.length} serious or critical violation(s): ${violations.map((v) => `${v.id} on ${v.page} (${v.impact}, ${v.nodes})`).join("; ")}`,
    "visual diff: not automated yet; the before/after images are the comparison",
    ...(broken.length > 0
      ? [
          `pages that answered with an error: ${[...new Set(broken.map((s) => `${s.page} (${s.status})`))].join(", ")}`,
        ]
      : []),
  ];
  return {
    task: task.card.id,
    kind: "ui-screenshots",
    passed,
    lines,
    shots,
    violations,
  };
}

/** The default publisher: the repo's GitHub, when there's a token and an origin. */
function githubPublisher(repoPath: string, task: string): Publish {
  return async (files) => {
    const token = (await githubToken(repoPath))?.token;
    const slug = await resolveRepoSlug(repoPath);
    if (!token || !slug) return null;
    const gh = new Octokit({ auth: token, log: QUIET_LOG });
    return publishEvidence({
      gh: gh as unknown as EvidenceClient,
      owner: slug.owner,
      repo: slug.repo,
      task,
      files,
    });
  };
}

/**
 * `factory task prove <id>`: run the assembly's proof against the built
 * worktree and record it. A failed proof sends the task back to build.
 */
export async function proveTask(
  repoPath: string,
  id: string,
  options: ProveOptions,
): Promise<{ task: Task; record: ProofRecord }> {
  const task = await loadTask(repoPath, id);
  if (task.problems.length > 0)
    throw new TaskError(`task ${id} fails verification; not proving`);
  if (nextStep(task) !== "prove")
    throw new TaskError(`task ${id} isn't ready to prove: ${nextStep(task)}`);
  const isolation = await loadIsolation(repoPath, id);
  if (!isolation) throw new TaskError(`task ${id} has no worktree`);
  const assembly = AssemblySchema.parse(parse(task.assemblyText ?? ""));

  const proofDir = join(repoPath, TASKS_DIR, id, "proof");
  const publish = options.publish ?? githubPublisher(repoPath, id);
  const record =
    assembly.proof === "ui-screenshots"
      ? await uiProof(repoPath, task, isolation, publish)
      : await testRun(isolation, assembly.proof, publish, proofDir);

  await mkdir(proofDir, { recursive: true });
  await writeFile(
    join(proofDir, "proof.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  const by = `factory runtime (for ${options.by})`;
  for (const line of record.lines)
    await task.ledger.append({
      beat: "prove",
      section: "proof",
      text: line,
      by,
      at: options.now,
    });
  await task.ledger.append({
    beat: "prove",
    section: "timeline",
    text: `proof ${record.passed ? "passed" : "failed"} · ${record.kind}`,
    by,
    at: options.now,
  });
  return { task: await loadTask(repoPath, id), record };
}
