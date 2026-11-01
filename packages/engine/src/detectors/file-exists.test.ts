import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
});
