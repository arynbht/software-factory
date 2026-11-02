import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { fileYamlPath } from "./file-yaml-path.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
);

describe("fileYamlPath", () => {
  const complete = () => buildContext(resolve(fixtures, "node-complete"));

  it("passes when a nested path exists", async () => {
    const result = await fileYamlPath(complete(), {
      type: "file-yaml-path",
      file: ".github/workflows/*.yml",
      path: "jobs.build.runs-on",
    });
    expect(result.status).toBe("pass");
  });

  it("resolves array indices with bracket syntax", async () => {
    const result = await fileYamlPath(complete(), {
      type: "file-yaml-path",
      file: ".github/workflows/ci.yml",
      path: "jobs.build.steps[0].uses",
      equals: "actions/checkout@v4",
    });
    expect(result.status).toBe("pass");
  });

  it("resolves top-level array items", async () => {
    const result = await fileYamlPath(complete(), {
      type: "file-yaml-path",
      file: ".github/workflows/ci.yml",
      path: "on[0]",
      equals: "push",
    });
    expect(result.status).toBe("pass");
  });

  it("fails when the value differs", async () => {
    const result = await fileYamlPath(complete(), {
      type: "file-yaml-path",
      file: ".github/workflows/ci.yml",
      path: "jobs.build.runs-on",
      equals: "windows-latest",
    });
    expect(result.status).toBe("fail");
  });

  it("exists:false passes when the path is absent", async () => {
    const result = await fileYamlPath(complete(), {
      type: "file-yaml-path",
      file: ".github/workflows/ci.yml",
      path: "jobs.build.nonexistent-key",
      exists: false,
    });
    expect(result.status).toBe("pass");
  });

  it("exists:false fails when the path is present", async () => {
    const result = await fileYamlPath(complete(), {
      type: "file-yaml-path",
      file: ".github/workflows/ci.yml",
      path: "jobs.build.runs-on",
      exists: false,
    });
    expect(result.status).toBe("fail");
  });

  it("fails when no file matches", async () => {
    const ctx = buildContext(resolve(fixtures, "empty"));
    const result = await fileYamlPath(ctx, {
      type: "file-yaml-path",
      file: ".github/workflows/*.yml",
      path: "jobs.build",
    });
    expect(result.status).toBe("fail");
  });
});
