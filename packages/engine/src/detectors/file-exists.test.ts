import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { fileExists } from "./file-exists.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
);

describe("fileExists", () => {
  it("passes when a matching file exists", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await fileExists(ctx, {
      type: "file-exists",
      path: "README.md",
    });
    expect(result.status).toBe("pass");
  });

  it("fails when no file matches", async () => {
    const ctx = buildContext(resolve(fixtures, "empty"));
    const result = await fileExists(ctx, {
      type: "file-exists",
      path: "README.md",
    });
    expect(result.status).toBe("fail");
    expect(result.remediation).toBeDefined();
  });

  it("supports pipe-delimited alternatives", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await fileExists(ctx, {
      type: "file-exists",
      path: "LICENSE|LICENSE.md|COPYING",
    });
    expect(result.status).toBe("pass");
  });

  it("matches globs", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await fileExists(ctx, {
      type: "file-exists",
      path: "*.editorconfig|.editorconfig",
    });
    expect(result.status).toBe("pass");
  });

  describe("with exclude (ci.workflow.present, issue #62)", () => {
    let dir: string | undefined;

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = undefined;
    });

    async function makeRepo(
      workflows: Record<string, string>,
    ): Promise<string> {
      dir = await mkdtemp(join(tmpdir(), "factory-fileexists-"));
      const wf = join(dir, ".github", "workflows");
      await mkdir(wf, { recursive: true });
      for (const [name, body] of Object.entries(workflows)) {
        await writeFile(join(wf, name), body);
      }
      return dir;
    }

    const config = {
      type: "file-exists",
      path: ".github/workflows/*.yml|.github/workflows/*.yaml",
      exclude: ".github/workflows/factory.yml|.github/workflows/factory.yaml",
    } as const;

    it("does NOT pass when only factory.yml is present", async () => {
      const ctx = buildContext(
        await makeRepo({ "factory.yml": "name: factory\n" }),
      );
      const result = await fileExists(ctx, config);
      expect(result.status).toBe("fail");
      expect(result.remediation).toBeDefined();
    });

    it("passes when a real ci.yml exists alongside factory.yml", async () => {
      const ctx = buildContext(
        await makeRepo({
          "factory.yml": "name: factory\n",
          "ci.yml": "name: CI\n",
        }),
      );
      const result = await fileExists(ctx, config);
      expect(result.status).toBe("pass");
      expect(result.message).toContain("ci.yml");
    });

    it("passes on a real ci.yml with no factory.yml at all", async () => {
      const ctx = buildContext(await makeRepo({ "ci.yml": "name: CI\n" }));
      const result = await fileExists(ctx, config);
      expect(result.status).toBe("pass");
    });
  });
});
