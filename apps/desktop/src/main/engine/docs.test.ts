import { describe, expect, it } from "vitest";

import { listDocs, readDoc } from "./docs";

describe("docs adapter", () => {
  it("lists the factory repo's Markdown docs (incl. ADRs)", async () => {
    const docs = await listDocs(process.cwd());
    expect(docs.length).toBeGreaterThan(0);
    const paths = docs.map((d) => d.path);
    expect(paths.some((p) => p.startsWith("docs/adr/"))).toBe(true);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  });

  it("reads a doc's markdown", async () => {
    const doc = await readDoc(process.cwd(), "docs/adr/0008-merge-policy.md");
    expect(doc.markdown).toContain("Merge policy");
  });

  it("rejects a missing doc", async () => {
    await expect(readDoc(process.cwd(), "docs/nope.md")).rejects.toThrow();
  });
});
