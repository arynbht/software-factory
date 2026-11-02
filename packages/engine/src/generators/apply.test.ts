import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadState } from "../state.js";
import { applyChanges } from "./apply.js";
import type { Change } from "./types.js";

const fileChange = (over: Partial<Change> = {}): Change =>
  ({
    type: "file",
    controlId: "c.x.y",
    path: "README.md",
    contents: "hello\n",
    op: "create",
    ...(over as object),
  }) as Change;

describe("applyChanges", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  const tmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), "factory-apply-"));
    made.push(d);
    return d;
  };

  it("creates a new file in write mode and records its hash", async () => {
    const dir = await tmp();
    const [r] = await applyChanges(dir, [fileChange()], { mode: "write" });
    expect(r?.action).toBe("create");
    expect(await readFile(join(dir, "README.md"), "utf8")).toBe("hello\n");
    expect((await loadState(dir)).managed?.["README.md"]).toBeDefined();
  });

  it("writes nothing in dry-run but reports the action", async () => {
    const dir = await tmp();
    const [r] = await applyChanges(dir, [fileChange()], { mode: "dry-run" });
    expect(r?.action).toBe("create");
    await expect(readFile(join(dir, "README.md"), "utf8")).rejects.toThrow();
  });

  it("never clobbers a human-written file (create op)", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "README.md"), "human wrote this\n", "utf8");
    const [r] = await applyChanges(dir, [fileChange()], { mode: "write" });
    expect(r?.action).toBe("skip");
    expect(await readFile(join(dir, "README.md"), "utf8")).toBe(
      "human wrote this\n",
    );
  });

  it("updates a factory-managed file that is unchanged since we wrote it", async () => {
    const dir = await tmp();
    await applyChanges(dir, [fileChange({ contents: "v1\n" })], {
      mode: "write",
    });
    const [r] = await applyChanges(dir, [fileChange({ contents: "v2\n" })], {
      mode: "write",
    });
    expect(r?.action).toBe("update");
    expect(await readFile(join(dir, "README.md"), "utf8")).toBe("v2\n");
  });

  it("is idempotent: re-applying identical content is 'unchanged'", async () => {
    const dir = await tmp();
    await applyChanges(dir, [fileChange()], { mode: "write" });
    const [r] = await applyChanges(dir, [fileChange()], { mode: "write" });
    expect(r?.action).toBe("unchanged");
  });

  it("merge op writes even over a human file (content is already merged)", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "ci.yml"), "jobs:\n", "utf8");
    const [r] = await applyChanges(
      dir,
      [
        fileChange({
          path: "ci.yml",
          contents: "jobs:\n  new: step\n",
          op: "merge",
        }),
      ],
      { mode: "write" },
    );
    expect(r?.action).toBe("update");
    // Exact content: a weaker `toContain` wouldn't catch a merge that dropped
    // or duplicated pre-existing keys.
    expect(await readFile(join(dir, "ci.yml"), "utf8")).toBe(
      "jobs:\n  new: step\n",
    );
  });

  it("diverts a merge to .factory-suggested when a managed file was human-edited", async () => {
    const dir = await tmp();
    // Factory writes ci.yml via merge and records its hash.
    await applyChanges(
      dir,
      [
        fileChange({
          path: "ci.yml",
          contents: "jobs:\n  a: 1\n",
          op: "merge",
        }),
      ],
      { mode: "write" },
    );
    // A human edits ci.yml afterwards.
    await writeFile(
      join(dir, "ci.yml"),
      "jobs:\n  a: 1\n  human: yes\n",
      "utf8",
    );

    // A new merge must not overwrite the human's edit; it writes a suggestion.
    const [r] = await applyChanges(
      dir,
      [
        fileChange({
          path: "ci.yml",
          contents: "jobs:\n  a: 2\n  human: yes\n",
          op: "merge",
        }),
      ],
      { mode: "write" },
    );
    expect(r?.action).toBe("suggest");
    expect(r?.path).toBe("ci.yml.factory-suggested");
    // The human's file is untouched; the suggestion sits alongside it.
    expect(await readFile(join(dir, "ci.yml"), "utf8")).toBe(
      "jobs:\n  a: 1\n  human: yes\n",
    );
    expect(await readFile(join(dir, "ci.yml.factory-suggested"), "utf8")).toBe(
      "jobs:\n  a: 2\n  human: yes\n",
    );
  });

  it("runs an effect only in write mode", async () => {
    const dir = await tmp();
    let ran = 0;
    const effect: Change = {
      type: "effect",
      controlId: "c.x.y",
      summary: "enable a setting",
      run: async () => {
        ran += 1;
      },
    };
    await applyChanges(dir, [effect], { mode: "dry-run" });
    expect(ran).toBe(0);
    const [r] = await applyChanges(dir, [effect], { mode: "write" });
    expect(ran).toBe(1);
    expect(r?.action).toBe("effect");
  });
});
