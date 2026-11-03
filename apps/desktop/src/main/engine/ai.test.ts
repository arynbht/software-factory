import { describe, expect, it } from "vitest";

import { listAiTasks } from "./ai";

// listAiTasks only reads the bundled prompt files (no model call), so it's a safe
// plain test. runAiTask/openAiPr call the model/git and aren't unit-tested here.
describe("listAiTasks", () => {
  it("lists the bundled AI tasks (sorted, with output paths)", async () => {
    const tasks = await listAiTasks();
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.task.length).toBeGreaterThan(0);
      expect(t.output.length).toBeGreaterThan(0);
    }
    const names = tasks.map((t) => t.task);
    expect(names).toEqual([...names].sort());
  });
});
