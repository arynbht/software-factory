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

  it("gives every node a unique id and never makes a node its own parent", async () => {
    const dupes: SwarmInvoke = ({ role }) =>
      role === "map"
        ? Promise.resolve({
            system: { title: "A", summary: "" },
            nodes: [
              { kind: "api" },
              { kind: "feature" },
              { id: "x", title: "X" },
              { id: "x", title: "X again" },
              { id: "self", title: "Self", parent: "self" },
            ],
          })
        : Promise.resolve({ edges: [] });
    const model = await runSwarm("/repo", {
      ...opts,
      invoke: dupes,
      listSlices: () => Promise.resolve([SLICES[0]!]),
    });
    const ids = model.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["pkg-a/n0", "pkg-a/n1", "pkg-a/x", "pkg-a/x-2"]),
    );
    expect(model.nodes.find((n) => n.id === "pkg-a/self")?.parent).toBe(
      "system:pkg-a",
    );
  });

  it("marks the model partial when slices are dropped over the cap", async () => {
    const model = await runSwarm("/repo", { ...opts, maxSlices: 1 });
    expect(model.summary.partial).toBe(true);
  });
});

describe("defaultListSlices", () => {
  it("skips dot-dirs so config never takes a package's slice", async () => {
    const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { defaultListSlices } = await import("./swarm.js");
    const root = await mkdtemp(join(tmpdir(), "slices-"));
    try {
      for (const d of [".github", ".changeset", "packages/a", "packages/b"])
        await mkdir(join(root, d), { recursive: true });
      expect((await defaultListSlices(root)).map((s) => s.key)).toEqual([
        "packages/a",
        "packages/b",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runSwarm — incremental reuse", () => {
  const stableFp = { ...opts, fingerprint: () => Promise.resolve("fp1") };

  it("reuses every slice and skips map + reduce when nothing changed", async () => {
    const base = await runSwarm("/repo", stableFp);
    const invoke2 = vi.fn(invoke);
    const model2 = await runSwarm("/repo", {
      ...stableFp,
      previous: base,
      invoke: invoke2,
    });

    const roles = invoke2.mock.calls.map((c) => c[0].role);
    expect(roles).not.toContain("map"); // no slice re-mapped
    expect(roles).not.toContain("reduce"); // connections reused
    // The model is still complete.
    expect(model2.nodes.some((n) => n.id === "pkg-a/api")).toBe(true);
    expect(model2.edges).toContainEqual({
      from: "system:pkg-a",
      to: "system:pkg-b",
      kind: "depends-on",
    });
    expect(model2.slices.every((s) => s.reused)).toBe(true);
  });

  it("re-maps only the changed slice and re-runs reduce", async () => {
    const base = await runSwarm("/repo", stableFp);
    const invoke3 = vi.fn(invoke);
    const model3 = await runSwarm("/repo", {
      ...opts,
      previous: base,
      invoke: invoke3,
      // pkg-b changed; pkg-a unchanged.
      fingerprint: (_r, s) =>
        Promise.resolve(s.key === "pkg-b" ? "fp-new" : "fp1"),
    });

    const mapped = invoke3.mock.calls
      .filter((c) => c[0].role === "map")
      .map((c) => c[0].slice?.key);
    expect(mapped).toEqual(["pkg-b"]);
    expect(invoke3.mock.calls.some((c) => c[0].role === "reduce")).toBe(true);
    // pkg-a was reused, pkg-b re-mapped.
    expect(model3.slices.find((s) => s.key === "pkg-a")?.reused).toBe(true);
    expect(
      model3.slices.find((s) => s.key === "pkg-b")?.reused,
    ).toBeUndefined();
  });
});

describe("runSwarm — verification pass", () => {
  it("drops cross-system edges the verifier rejects", async () => {
    const withVerify: SwarmInvoke = (spec) =>
      spec.role === "verify"
        ? Promise.resolve({ drop: [0], confidence: 0.9 })
        : invoke(spec);
    const model = await runSwarm("/repo", {
      ...opts,
      verify: true,
      invoke: withVerify,
    });

    // The single reduce cross-edge (index 0) is pruned…
    expect(
      model.edges.some(
        (e) => e.from === "system:pkg-a" && e.to === "system:pkg-b",
      ),
    ).toBe(false);
    // …but intra-slice edges from file exploration are untouched.
    expect(model.edges).toContainEqual({
      from: "pkg-a/api",
      to: "pkg-a/db",
      kind: "reads",
    });
  });
});
