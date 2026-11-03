import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractJson } from "./agent.js";
import { isStale, loadFloorPlan, saveFloorPlan } from "./store.js";
import type { RepositoryModel } from "./types.js";

function model(commit?: string): RepositoryModel {
  return {
    version: 1,
    generatedAt: "2026-11-03T00:00:00.000Z",
    repoPath: "/repo",
    ...(commit ? { commit } : {}),
    summary: { nodeCount: 1, edgeCount: 0, systemCount: 1, partial: false },
    nodes: [
      { id: "system:a", kind: "system", title: "A", summary: "", paths: ["a"] },
    ],
    edges: [],
    detected: { stack: ["typescript"], flags: {}, confidence: 0.5 },
    slices: [{ key: "a", nodeIds: ["system:a"] }],
  };
}

describe("floor-plan store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips save → load", async () => {
    await saveFloorPlan(dir, model("abc"));
    const loaded = await loadFloorPlan(dir);
    expect(loaded?.commit).toBe("abc");
    expect(loaded?.nodes[0]?.id).toBe("system:a");
  });

  it("writes to .factory/floorplan.json", async () => {
    await saveFloorPlan(dir, model("abc"));
    const raw = await readFile(
      resolve(dir, ".factory", "floorplan.json"),
      "utf8",
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).version).toBe(1);
  });

  it("returns null for a missing file", async () => {
    expect(await loadFloorPlan(dir)).toBeNull();
  });

  it("returns null for a corrupt / wrong-shape file", async () => {
    await mkdir(resolve(dir, ".factory"), { recursive: true });
    await writeFile(
      resolve(dir, ".factory", "floorplan.json"),
      "{ not json",
      "utf8",
    );
    expect(await loadFloorPlan(dir)).toBeNull();
    await writeFile(
      resolve(dir, ".factory", "floorplan.json"),
      JSON.stringify({ version: 2 }),
      "utf8",
    );
    expect(await loadFloorPlan(dir)).toBeNull();
  });
});

describe("isStale", () => {
  const head = (h: string | undefined) => () => Promise.resolve(h);

  it("is stale when there is no model", async () => {
    expect(await isStale("/repo", null, head("abc"))).toBe(true);
  });

  it("is fresh when HEAD matches the model's commit", async () => {
    expect(await isStale("/repo", model("abc"), head("abc"))).toBe(false);
  });

  it("is stale when HEAD has moved", async () => {
    expect(await isStale("/repo", model("abc"), head("def"))).toBe(true);
  });

  it("is stale when HEAD can't be determined", async () => {
    expect(await isStale("/repo", model("abc"), head(undefined))).toBe(true);
  });

  it("is stale when the model has no recorded commit", async () => {
    expect(await isStale("/repo", model(), head("abc"))).toBe(true);
  });
});

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses a fenced JSON block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJson('Here it is: {"a":1} done')).toEqual({ a: 1 });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
