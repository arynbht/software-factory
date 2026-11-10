import { describe, expect, it } from "vitest";

import { renderArchitectureDoc } from "./doc.js";
import type { RepositoryModel } from "./types.js";

const model: RepositoryModel = {
  version: 1,
  generatedAt: "2026-11-03T00:00:00.000Z",
  repoPath: "/repo",
  summary: { nodeCount: 3, edgeCount: 1, systemCount: 2, partial: false },
  nodes: [
    {
      id: "system:api",
      kind: "system",
      title: "API Service",
      summary: "the api",
      paths: ["api"],
    },
    {
      id: "api/routes",
      kind: "api",
      title: "Routes",
      summary: "http handlers",
      paths: ["api/routes.ts"],
      tech: ["express"],
      parent: "system:api",
    },
    {
      id: "system:db",
      kind: "system",
      title: "Database",
      summary: "storage",
      paths: ["db"],
    },
  ],
  edges: [{ from: "system:api", to: "system:db", kind: "reads" }],
  detected: {
    type: "api",
    stack: ["typescript", "express"],
    flags: { "uses-ai": false, "multi-service": true },
    phase: "build",
    confidence: 0.75,
  },
  slices: [],
};

describe("renderArchitectureDoc", () => {
  const md = renderArchitectureDoc(model);

  it("renders a Mermaid systems diagram with the cross edge", () => {
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart LR");
    expect(md).toContain('["API Service"]');
    expect(md).toMatch(/s\d+ -->\|reads\| s\d+/);
  });

  it("lists each system and its children", () => {
    expect(md).toContain("## API Service");
    expect(md).toContain("**Routes** — api _(express)_: http handlers");
    expect(md).toContain("## Database");
  });

  it("summarizes the detected profile", () => {
    expect(md).toContain("## Detected profile");
    expect(md).toContain("**type**: api");
    expect(md).toContain("**stack**: typescript, express");
    expect(md).toContain("**flags**: multi-service");
    expect(md).toContain("**confidence**: 75%");
  });

  it("flags a partial model", () => {
    const partial = renderArchitectureDoc({
      ...model,
      summary: { ...model.summary, partial: true },
    });
    expect(partial).toContain("Partial model");
  });
});
