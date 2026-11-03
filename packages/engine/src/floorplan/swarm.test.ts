import { describe, expect, it, vi } from "vitest";

import { runSwarm, type Slice, type SwarmInvoke } from "./swarm.js";

const SLICES: Slice[] = [
  { key: "pkg-a", title: "pkg-a", dir: "packages/a" },
  { key: "pkg-b", title: "pkg-b", dir: "packages/b" },
];

/** Canned agent replies keyed by role + slice. */
const invoke: SwarmInvoke = ({ role, slice }) => {
  if (role === "map" && slice?.key === "pkg-a") {
    return Promise.resolve({
      system: { title: "Service A", summary: "the api" },
      nodes: [
        {
          id: "api",
          kind: "api",
          title: "API",
          summary: "",
          paths: ["a/api.ts"],
        },
        { id: "db", kind: "datastore", title: "DB", paths: [] },
      ],
      edges: [{ from: "api", to: "db", kind: "reads" }],
      signals: {
        type: "api",
        stack: ["typescript"],
        flags: { "uses-ai": true },
      },
    });
  }
  if (role === "map" && slice?.key === "pkg-b") {
    return Promise.resolve({
      system: { title: "Worker B", summary: "the worker" },
      // Same raw id "api" as pkg-a — must not collide after prefixing.
      nodes: [{ id: "api", kind: "subsystem", title: "Worker" }],
      edges: [{ from: "api", to: "ghost", kind: "calls" }], // dangling → dropped
      signals: { stack: ["node"] },
    });
  }
  // reduce
  return Promise.resolve({
    edges: [{ from: "system:pkg-a", to: "system:pkg-b", kind: "depends-on" }],
    detected: {
      type: "monorepo",
      stack: ["pnpm"],
      flags: { "multi-service": true },
      confidence: 0.8,
    },
  });
};

const opts = {
  invoke,
  listSlices: () => Promise.resolve(SLICES),
  gitHead: () => Promise.resolve("abc123"),
  now: () => new Date("2026-11-03T00:00:00.000Z"),
};

describe("runSwarm", () => {
  it("assembles system + child nodes with slice-prefixed ids", async () => {
    const model = await runSwarm("/repo", opts);
    const ids = model.nodes.map((n) => n.id).sort();
    expect(ids).toContain("system:pkg-a");
    expect(ids).toContain("system:pkg-b");
    expect(ids).toContain("pkg-a/api");
    expect(ids).toContain("pkg-a/db");
    // The two "api" nodes from different slices don't collide.
    expect(ids).toContain("pkg-b/api");
    expect(ids.filter((i) => i === "pkg-a/api")).toHaveLength(1);
  });

  it("nests slice nodes under their system node", async () => {
    const model = await runSwarm("/repo", opts);
    const api = model.nodes.find((n) => n.id === "pkg-a/api");
    expect(api?.parent).toBe("system:pkg-a");
  });

  it("keeps intra-slice edges and drops dangling ones", async () => {
    const model = await runSwarm("/repo", opts);
    expect(model.edges).toContainEqual({
      from: "pkg-a/api",
      to: "pkg-a/db",
      kind: "reads",
    });
    // pkg-b's edge referenced a non-existent "ghost" node → dropped.
    expect(model.edges.some((e) => e.to.includes("ghost"))).toBe(false);
  });

  it("adds reduce-resolved cross-system edges", async () => {
    const model = await runSwarm("/repo", opts);
    expect(model.edges).toContainEqual({
      from: "system:pkg-a",
      to: "system:pkg-b",
      kind: "depends-on",
    });
  });

  it("merges detected profile from slice signals and reduce", async () => {
    const model = await runSwarm("/repo", opts);
    expect(model.detected.type).toBe("monorepo");
    expect(model.detected.stack.sort()).toEqual(["node", "pnpm", "typescript"]);
    expect(model.detected.flags["uses-ai"]).toBe(true);
    expect(model.detected.flags["multi-service"]).toBe(true);
    expect(model.detected.confidence).toBe(0.8);
  });

  it("records commit, timestamp and non-partial summary", async () => {
    const model = await runSwarm("/repo", opts);
    expect(model.commit).toBe("abc123");
    expect(model.generatedAt).toBe("2026-11-03T00:00:00.000Z");
    expect(model.summary.systemCount).toBe(2);
    expect(model.summary.partial).toBe(false);
    expect(model.summary.nodeCount).toBe(model.nodes.length);
  });

  it("degrades to a partial model when a slice agent fails", async () => {
    const failing: SwarmInvoke = (spec) =>
      spec.role === "map" && spec.slice?.key === "pkg-b"
        ? Promise.reject(new Error("boom"))
        : invoke(spec);
    const model = await runSwarm("/repo", { ...opts, invoke: failing });
    expect(model.summary.partial).toBe(true);
    const sys = model.nodes.find((n) => n.id === "system:pkg-b");
    expect(sys?.summary).toMatch(/analysis failed: boom/);
    // The healthy slice still contributed.
    expect(model.nodes.some((n) => n.id === "pkg-a/api")).toBe(true);
  });

  it("emits progress for each phase", async () => {
    const onProgress = vi.fn();
    await runSwarm("/repo", { ...opts, onProgress });
    const phases = onProgress.mock.calls.map((c) => c[0].phase);
    expect(phases).toContain("slice");
    expect(phases).toContain("map");
    expect(phases).toContain("reduce");
    expect(phases).toContain("done");
  });
});
