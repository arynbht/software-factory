import { readdir } from "node:fs/promises";

import { bundledPromptsDir } from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import { loadPrompt } from "./generate.js";

// A format-drift guard: every shipped prompt must parse and carry the fields the
// generator relies on. Catches a broken front-matter or a renamed field before it
// reaches a live call.
describe("bundled prompt templates", () => {
  it("every prompt parses with a valid front-matter and non-empty body", async () => {
    const files = (await readdir(bundledPromptsDir())).filter((f) =>
      f.endsWith(".md"),
    );
    expect(files.length).toBeGreaterThanOrEqual(9);

    for (const file of files) {
      const task = file.replace(/\.md$/, "");
      const prompt = await loadPrompt(task);
      expect(prompt.task, `${file}: task`).toBe(task);
      expect(prompt.output.length, `${file}: output`).toBeGreaterThan(0);
      expect(prompt.output.endsWith(".md"), `${file}: output is .md`).toBe(
        true,
      );
      expect(prompt.system.length, `${file}: system body`).toBeGreaterThan(40);
      expect(Array.isArray(prompt.globs), `${file}: globs`).toBe(true);
      expect(Array.isArray(prompt.checklist), `${file}: checklist`).toBe(true);
    }
  });
});
