import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { exitCodeForCi, runCi } from "./ci.js";

describe("exitCodeForCi", () => {
  it("fails only on a pull request with a red gate", () => {
    expect(exitCodeForCi(true, "red")).toBe(1);
    expect(exitCodeForCi(true, "amber")).toBe(0);
    expect(exitCodeForCi(true, "green")).toBe(0);
  });

  it("never fails a non-PR (scheduled/push) run", () => {
    expect(exitCodeForCi(false, "red")).toBe(0);
    expect(exitCodeForCi(false, "amber")).toBe(0);
    expect(exitCodeForCi(false, "green")).toBe(0);
  });
});

// Any github-api detector call falls through to this 404 so it skips (fail-soft),
// leaving the test to assert only the comment/issue endpoints it cares about.
const server = setupServer(
  http.all(
    "https://api.github.com/*",
    () => new HttpResponse(null, { status: 404 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("runCi (integration)", () => {
  const made: string[] = [];
  const ENV_KEYS = [
    "GITHUB_REPOSITORY",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "FACTORY_GATE",
    "GITHUB_WORKSPACE",
    "GITHUB_EVENT_PATH",
    "GITHUB_STEP_SUMMARY",
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
    vi.restoreAllMocks();
  });

  async function workspace(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "factory-ci-"));
    made.push(dir);
    process.env.GITHUB_WORKSPACE = dir;
    return dir;
  }

  it("fails closed on an unknown gate", async () => {
    await workspace();
    process.env.GITHUB_REPOSITORY = "o/r";
    process.env.GITHUB_TOKEN = "x";
    process.env.FACTORY_GATE = "bogus-gate";
    expect(await runCi()).toBe(1);
  });

  it("posts a sticky PR comment and fails on a red gate", async () => {
    await workspace();
    process.env.GITHUB_REPOSITORY = "o/r";
    process.env.GITHUB_TOKEN = "x";
    process.env.FACTORY_GATE = "build";

    const eventPath = join(await workspace(), "event.json");
    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 5 } }));
    process.env.GITHUB_EVENT_PATH = eventPath;

    const posted: unknown[] = [];
    server.use(
      http.get("https://api.github.com/repos/o/r/issues/5/comments", () =>
        HttpResponse.json([]),
      ),
      http.post(
        "https://api.github.com/repos/o/r/issues/5/comments",
        async ({ request }) => {
          posted.push(await request.json());
          return HttpResponse.json({ id: 1 });
        },
      ),
    );

    // An empty repo fails build-phase controls → red gate → PR exits 1.
    expect(await runCi()).toBe(1);
    expect(posted).toHaveLength(1);
  });

  it("maintains the status issue on a scheduled (non-PR) run and never fails", async () => {
    await workspace();
    process.env.GITHUB_REPOSITORY = "o/r";
    process.env.GITHUB_TOKEN = "x";
    process.env.FACTORY_GATE = "build";
    // No GITHUB_EVENT_PATH → not a PR.

    const created: unknown[] = [];
    server.use(
      http.get("https://api.github.com/repos/o/r/issues", () =>
        HttpResponse.json([]),
      ),
      http.post(
        "https://api.github.com/repos/o/r/issues",
        async ({ request }) => {
          created.push(await request.json());
          return HttpResponse.json({ number: 9, title: "Factory status" });
        },
      ),
    );

    expect(await runCi()).toBe(0);
    expect(created).toHaveLength(1); // a red gate opens the status issue
  });

  it("writes the report to the job summary", async () => {
    const dir = await workspace();
    process.env.GITHUB_REPOSITORY = "o/r";
    process.env.GITHUB_TOKEN = "x";
    process.env.FACTORY_GATE = "build";
    const summary = join(dir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summary;

    server.use(
      http.get("https://api.github.com/repos/o/r/issues", () =>
        HttpResponse.json([]),
      ),
      http.post("https://api.github.com/repos/o/r/issues", () =>
        HttpResponse.json({ number: 9 }),
      ),
    );

    await runCi();
    expect(await readFile(summary, "utf8")).toContain("Factory audit");
  });

  it("warns and does not fail a non-PR run when the repository is unset", async () => {
    await workspace();
    process.env.GITHUB_TOKEN = "x";
    process.env.FACTORY_GATE = "build";
    // GITHUB_REPOSITORY unset → owner/repo missing → no API calls.
    expect(await runCi()).toBe(0);
  });
});
