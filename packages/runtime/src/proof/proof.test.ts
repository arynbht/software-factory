// The prove beat on real repos: the test-run proof names new tests and sends a
// failure back to build; the UI proof serves base and change, shoots both at
// three breakpoints, runs axe, and hands the images to the evidence publisher.
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifests } from "@arynbht/factory-registry";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AgentCall, buildTask } from "../agent/build.js";
import { isolateTask } from "../agent/isolate.js";
import {
  approveRoute,
  type RouteContext,
  routeTask,
} from "../router/task-route.js";
import { confirmTask, newTask, nextStep } from "../task/tasks.js";
import { type EvidenceClient, publishEvidence } from "./evidence.js";
import { proveTask } from "./prove.js";
import { startServer } from "./server.js";
import { browserAvailable } from "./shoot.js";

const made: string[] = [];
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
const savedConfig = process.env.FACTORY_CONFIG_DIR;
const by = { by: "dev@example.com", now: new Date("2026-11-10T18:00:00Z") };
let context: RouteContext;

beforeEach(async () => {
  process.env.FACTORY_CONFIG_DIR = await tmp("factory-config-");
});
afterEach(async () => {
  if (savedConfig === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = savedConfig;
  for (const d of made) {
    await simpleGit(d)
      .raw(["worktree", "prune"])
      .catch(() => undefined);
    await rm(d, { recursive: true, force: true });
  }
  made.length = 0;
});

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await tmp("factory-proof-");
  const git = simpleGit(repo);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  await git.add(["-A"]);
  await git.commit("base", ["--no-verify"]);
  const { manifests } = await loadManifests(repo);
  context = {
    manifests,
    available: new Set(),
    flags: {},
    files: Object.keys(files),
    checks: ["quality.tests.pass"],
  };
  return repo;
}

/** Route, approve, isolate and build a task with a scripted edit. */
async function built(
  repo: string,
  card: { title: string; type: "fix" | "feature"; pages?: string[] },
  edit: (cwd: string) => Promise<void>,
): Promise<string> {
  const draft = await newTask(
    repo,
    {
      ...card,
      description: card.title,
      acceptance: [{ id: "A1", text: "It works", verify: "e2e" }],
    },
    by,
  );
  const id = draft.card.id;
  await confirmTask(repo, id, by);
  await routeTask(repo, id, { ...by, context });
  await approveRoute(repo, id, { ...by, context });
  await isolateTask(repo, id, { ...by, base: "main" });
  const agent = async (call: AgentCall) => {
    if (call.mode === "plan") return JSON.stringify({ steps: ["do it"] });
    await edit(call.cwd);
    return "done";
  };
  const outcome = await buildTask(repo, id, { ...by, agent });
  expect(outcome.stops).toEqual([]);
  return id;
}

describe("evidence", () => {
  it("starts an orphan evidence branch and uploads each image under the task", async () => {
    const dir = await tmp("evidence-");
    const file = join(dir, "after-home-sm.png");
    await writeFile(file, "png-bytes");
    const calls: string[] = [];
    const notFound = Object.assign(new Error("nope"), { status: 404 });
    const gh: EvidenceClient = {
      rest: {
        repos: {
          getBranch: () => Promise.reject(notFound),
          getContent: () => Promise.reject(notFound),
          createOrUpdateFileContents: (p) => {
            calls.push(`put ${p.branch}:${p.path} ${p.content}`);
            return Promise.resolve({});
          },
        },
        git: {
          createTree: () => Promise.resolve({ data: { sha: "tree" } }),
          createCommit: (p) => {
            calls.push(`commit parents=${p.parents.length}`);
            return Promise.resolve({ data: { sha: "c1" } });
          },
          createRef: (p) => {
            calls.push(`ref ${p.ref}`);
            return Promise.resolve({});
          },
        },
      },
    };
    const urls = await publishEvidence({
      gh,
      owner: "o",
      repo: "r",
      task: "T-0001",
      files: [file],
    });
    expect(calls).toEqual([
      "commit parents=0",
      "ref refs/heads/evidence",
      `put evidence:T-0001/after-home-sm.png ${Buffer.from("png-bytes").toString("base64")}`,
    ]);
    expect(urls[0]?.url).toBe(
      "https://github.com/o/r/blob/evidence/T-0001/after-home-sm.png?raw=true",
    );
  });
});

describe("server", { timeout: 60_000 }, () => {
  it("waits for the URL, and says why when the command dies first", async () => {
    const dir = await tmp("server-");
    await writeFile(
      join(dir, "server.js"),
      'require("http").createServer((q, s) => s.end("ok")).listen(process.env.PORT);\n',
    );
    const server = await startServer({
      command: "node server.js",
      cwd: dir,
      port: 5391,
    });
    expect(await (await fetch(server.url)).text()).toBe("ok");
    await server.stop();
    await expect(
      startServer({ command: "node missing.js", cwd: dir, port: 5392 }),
    ).rejects.toThrow(/exited/);
  });

  it("refuses a port something else already answers on", async () => {
    const dir = await tmp("server-");
    await writeFile(
      join(dir, "server.js"),
      'require("http").createServer((q, s) => s.end("ok")).listen(process.env.PORT);\n',
    );
    const first = await startServer({
      command: "node server.js",
      cwd: dir,
      port: 5393,
    });
    try {
      await expect(
        startServer({ command: "node server.js", cwd: dir, port: 5393 }),
      ).rejects.toThrow("port 5393 is in use");
    } finally {
      await first.stop();
    }
  });
});

describe("test-run proof", { timeout: 120_000 }, () => {
  const BASE = {
    "package.json": `${JSON.stringify({ name: "demo", scripts: { test: "node --test" } }, null, 2)}\n`,
    "src/total.js": "exports.total = () => 0;\n",
  };

  it("runs the tests and names the ones the change added", async () => {
    const repo = await repoWith(BASE);
    const id = await built(
      repo,
      { title: "Fix total so it sums", type: "fix" },
      async (cwd) => {
        await writeFile(
          join(cwd, "src/total.js"),
          "exports.total = (l) => l.reduce((a, b) => a + b, 0);\n",
        );
        await writeFile(
          join(cwd, "src/total.test.js"),
          'const t = require("node:test"); const a = require("node:assert"); const { total } = require("./total.js");\nt.test("sums", () => a.equal(total([1, 2, 3]), 6));\n',
        );
      },
    );
    const { task, record } = await proveTask(repo, id, by);
    expect(record.passed).toBe(true);
    expect(record.tests?.added).toEqual(["src/total.test.js"]);
    expect(record.lines[0]).toMatch(
      /^tests passed \(pnpm run test, exit 0\) · new tests: src\/total\.test\.js/,
    );
    expect(nextStep(task)).toBe("judge");
    await expect(proveTask(repo, id, by)).rejects.toThrow("isn't ready");
  });

  it("a failing test fails the proof and goes back to build, told why", async () => {
    const repo = await repoWith(BASE);
    const id = await built(
      repo,
      { title: "Fix total so it sums", type: "fix" },
      (cwd) =>
        writeFile(
          join(cwd, "src/total.test.js"),
          'require("node:test").test("sums", () => require("node:assert").equal(1, 2));\n',
        ),
    );
    const { task, record } = await proveTask(repo, id, by);
    expect(record.passed).toBe(false);
    expect(nextStep(task)).toMatch(/^build: .*the proof failed/);
    const calls: AgentCall[] = [];
    await buildTask(repo, id, {
      ...by,
      agent: async (call) => {
        calls.push(call);
        return "fixed";
      },
    });
    expect(calls[0]?.prompt).toContain(
      "Since your last round: the proof failed; fix the change so it passes — tests failed",
    );
  });
});

const hasBrowser = await browserAvailable();

describe.skipIf(!hasBrowser)("UI proof", { timeout: 180_000 }, () => {
  const page = (body: string) =>
    `<!doctype html><html lang="en"><head><title>Demo</title></head><body><main>${body}</main></body></html>`;
  const server = (html: string) =>
    `require("http").createServer((q, s) => { s.setHeader("content-type", "text/html"); s.end(${JSON.stringify(html)}); }).listen(process.env.PORT);\n`;
  const BASE = {
    "package.json": `${JSON.stringify({ name: "demo" }, null, 2)}\n`,
    "server.js": server(page("<h1>Settings</h1>")),
    ".factory/profile.yml":
      "version: 1\nname: demo\ntype: web-app\nproof:\n  start: node server.js\n",
  };

  it("shoots before and after at three breakpoints, and axe passes a clean page", async () => {
    const repo = await repoWith(BASE);
    const id = await built(
      repo,
      { title: "Redesign the settings page", type: "feature" },
      (cwd) =>
        writeFile(
          join(cwd, "server.js"),
          server(page("<h1>Settings</h1><p>Rebuilt.</p>")),
        ),
    );
    const published: string[] = [];
    const { task, record } = await proveTask(repo, id, {
      ...by,
      publish: async (files) => {
        published.push(...files);
        return files.map((file) => ({ file, url: `https://example/${file}` }));
      },
    });
    expect(record.kind).toBe("ui-screenshots");
    expect(record.passed).toBe(true);
    expect(record.shots?.map((s) => `${s.side}-${s.breakpoint}`)).toEqual([
      "before-sm",
      "before-md",
      "before-lg",
      "after-sm",
      "after-md",
      "after-lg",
    ]);
    for (const shot of record.shots ?? []) await access(shot.file);
    expect(published).toHaveLength(6);
    expect(record.lines[0]).toContain("on the evidence branch: T-0001/");
    expect(record.lines[1]).toBe("axe: 0 serious or critical violations");
    expect(nextStep(task)).toBe("judge");
    const ledger = await readFile(task.ledger.mdPath, "utf8");
    expect(ledger).toContain("## Proof");
  });

  it("a change that won't serve fails the proof and goes back to build", async () => {
    const repo = await repoWith(BASE);
    const id = await built(
      repo,
      { title: "Redesign the settings page", type: "feature" },
      (cwd) => writeFile(join(cwd, "server.js"), 'throw new Error("boom");\n'),
    );
    const { task, record } = await proveTask(repo, id, {
      ...by,
      publish: async () => null,
    });
    expect(record.passed).toBe(false);
    expect(record.lines[0]).toMatch(/^the change didn't serve: .*boom/);
    expect(nextStep(task)).toMatch(/^build: .*the proof failed/);
  });

  it("runs axe on an app whose CSP blocks inline scripts", async () => {
    const repo = await repoWith(BASE);
    const strict = `require("http").createServer((q, s) => { s.setHeader("content-type", "text/html"); s.setHeader("content-security-policy", "script-src 'self'"); s.end(${JSON.stringify(page('<h1>Settings</h1><img src="/x.png">'))}); }).listen(process.env.PORT);\n`;
    const id = await built(
      repo,
      { title: "Redesign the settings page", type: "feature" },
      (cwd) => writeFile(join(cwd, "server.js"), strict),
    );
    const { record } = await proveTask(repo, id, {
      ...by,
      publish: async () => null,
    });
    // axe ran (and found the missing alt), rather than the CSP failing it.
    expect(record.lines[1]).toMatch(/image-alt/);
  });

  it("a page the change serves as an error fails the proof", async () => {
    const repo = await repoWith(BASE);
    const failing = `require("http").createServer((q, s) => { s.statusCode = 500; s.setHeader("content-type", "text/html"); s.end(${JSON.stringify(page("<h1>Oops</h1>"))}); }).listen(process.env.PORT);\n`;
    const id = await built(
      repo,
      { title: "Redesign the settings page", type: "feature" },
      (cwd) => writeFile(join(cwd, "server.js"), failing),
    );
    const { record } = await proveTask(repo, id, {
      ...by,
      publish: async () => null,
    });
    expect(record.passed).toBe(false);
    expect(record.lines).toContain(
      "pages that answered with an error: / (500)",
    );
  });

  it("keeps pages that look alike in separate images", async () => {
    const repo = await repoWith(BASE);
    const id = await built(
      repo,
      {
        title: "Redesign the settings page",
        type: "feature",
        pages: ["/settings?tab=a", "/settings?tab=b"],
      },
      (cwd) => writeFile(join(cwd, "server.js"), server(page("<h1>New</h1>"))),
    );
    const { record } = await proveTask(repo, id, {
      ...by,
      publish: async () => null,
    });
    const files = record.shots?.map((s) => s.file) ?? [];
    expect(files).toHaveLength(12);
    expect(new Set(files).size).toBe(12);
  });

  it("an image without alt text fails the proof", async () => {
    const repo = await repoWith(BASE);
    const id = await built(
      repo,
      { title: "Redesign the settings page", type: "feature" },
      (cwd) =>
        writeFile(
          join(cwd, "server.js"),
          server(page('<h1>Settings</h1><img src="/logo.png">')),
        ),
    );
    const { record } = await proveTask(repo, id, {
      ...by,
      publish: async () => null,
    });
    expect(record.passed).toBe(false);
    expect(record.lines[1]).toMatch(
      /^axe: 1 serious or critical violation\(s\): image-alt on \//,
    );
    expect(record.lines[0]).toContain("not pushed");
  });
});
