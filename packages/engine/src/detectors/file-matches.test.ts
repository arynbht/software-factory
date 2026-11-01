import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { fileMatches } from "./file-matches.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
);

describe("fileMatches", () => {
  it("passes when a file matches the pattern (with inline (?i) flag)", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await fileMatches(ctx, {
      type: "file-matches",
      path: "README.md",
      pattern: "(?i)##\\s+setup",
    });
    expect(result.status).toBe("pass");
  });

  it("fails when the pattern is absent from an existing file", async () => {
    const ctx = buildContext(resolve(fixtures, "node-minimal"));
    const result = await fileMatches(ctx, {
      type: "file-matches",
      path: "README.md",
      pattern: "## Setup",
    });
    expect(result.status).toBe("fail");
  });

  it("fails when no file matches the path", async () => {
    const ctx = buildContext(resolve(fixtures, "empty"));
    const result = await fileMatches(ctx, {
      type: "file-matches",
      path: "README.md",
      pattern: "anything",
    });
    expect(result.status).toBe("fail");
  });

  it("skips on an invalid regex", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await fileMatches(ctx, {
      type: "file-matches",
      path: "README.md",
      pattern: "(unclosed",
    });
    expect(result.status).toBe("skip");
  });
});
