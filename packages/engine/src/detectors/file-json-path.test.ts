import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { fileJsonPath } from "./file-json-path.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
);

describe("fileJsonPath", () => {
  const complete = () => buildContext(resolve(fixtures, "node-complete"));

  it("passes when a path exists", async () => {
    const result = await fileJsonPath(complete(), {
      type: "file-json-path",
      file: "package.json",
      path: "scripts.lint",
    });
    expect(result.status).toBe("pass");
  });

  it("passes when a path equals a value (reading JSONC with comments)", async () => {
    const result = await fileJsonPath(complete(), {
      type: "file-json-path",
      file: "tsconfig.json",
      path: "compilerOptions.strict",
      equals: true,
    });
    expect(result.status).toBe("pass");
  });

  it("fails when a path does not equal the expected value", async () => {
    const result = await fileJsonPath(complete(), {
      type: "file-json-path",
      file: "tsconfig.json",
      path: "compilerOptions.strict",
      equals: false,
    });
    expect(result.status).toBe("fail");
  });

  it("fails when the path is missing", async () => {
    const result = await fileJsonPath(complete(), {
      type: "file-json-path",
      file: "package.json",
      path: "scripts.nonexistent",
    });
    expect(result.status).toBe("fail");
  });

  it("fails when the file does not exist", async () => {
    const ctx = buildContext(resolve(fixtures, "node-minimal"));
    const result = await fileJsonPath(ctx, {
      type: "file-json-path",
      file: "tsconfig.json",
      path: "compilerOptions.strict",
      equals: true,
    });
    expect(result.status).toBe("fail");
  });
});
