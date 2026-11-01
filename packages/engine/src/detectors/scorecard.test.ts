import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { extractCheckScore, scorecard } from "./scorecard.js";

const repo = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
  "empty",
);

const sample = JSON.stringify({
  checks: [
    { name: "Token-Permissions", score: 8 },
    { name: "Pinned-Dependencies", score: 3 },
    { name: "Inconclusive-Check", score: -1 },
  ],
});

describe("extractCheckScore", () => {
  it("returns the score for a named check (case-insensitive)", () => {
    expect(extractCheckScore(sample, "token-permissions")).toBe(8);
  });

  it("returns null for an unknown check", () => {
    expect(extractCheckScore(sample, "Nope")).toBeNull();
  });

  it("returns null for non-JSON output", () => {
    expect(extractCheckScore("not json at all", "x")).toBeNull();
  });
});

describe("scorecard detector", () => {
  it("skips when scorecard is not installed", async () => {
    const result = await scorecard(buildContext(repo), {
      type: "scorecard",
      check: "Token-Permissions",
      min: 7,
    });
    expect(result.status).toBe("skip");
  });
});
