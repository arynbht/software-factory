import { describe, expect, it } from "vitest";

import { findProtected } from "./protected.js";
import { parseAddedLines, parseNameStatus } from "./tier1.js";

describe("findProtected", () => {
  const none = new Map<string, string[]>();

  it("flags factory state, lint config and CI config", () => {
    const findings = findProtected(
      [
        { status: "M", path: ".factory/waivers.yml" },
        { status: "A", path: "eslint.config.js" },
        { status: "M", path: ".github/workflows/ci.yml" },
        { status: "M", path: "src/app.ts" },
      ],
      none,
      false,
    );
    expect(findings.map((f) => f.reason)).toEqual([
      "factory-state",
      "lint-config",
      "ci-config",
    ]);
  });

  it("allows new tests but not edits to or deletions of existing ones", () => {
    const findings = findProtected(
      [
        { status: "A", path: "src/new.test.ts" },
        { status: "M", path: "src/old.test.ts" },
        { status: "D", path: "tests/test_api.py" },
        {
          status: "R",
          path: "src/renamed.spec.ts",
          oldPath: "src/orig.spec.ts",
        },
      ],
      none,
      false,
    );
    expect(findings.map((f) => [f.reason, f.path])).toEqual([
      ["existing-test", "src/old.test.ts"],
      ["existing-test", "tests/test_api.py"],
      ["existing-test", "src/renamed.spec.ts"],
    ]);
  });

  it("flags changed scripts and added suppressions", () => {
    const added = new Map([
      ["src/a.ts", ["const x = 1;", "// @ts-ignore", "y();"]],
      ["app.py", ["import os  # noqa: F401"]],
      ["src/b.ts", ["const fine = true;"]],
    ]);
    const findings = findProtected([], added, true);
    expect(findings.map((f) => [f.reason, f.path])).toEqual([
      ["scripts", "package.json"],
      ["suppression", "src/a.ts"],
      ["suppression", "app.py"],
    ]);
  });
});

describe("diff parsing", () => {
  it("parses name-status output, including renames", () => {
    expect(
      parseNameStatus("M\tsrc/a.ts\nA\tb.ts\nD\tc.ts\nR095\told.ts\tnew.ts\n"),
    ).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "b.ts" },
      { status: "D", path: "c.ts" },
      { status: "R", path: "new.ts", oldPath: "old.ts" },
    ]);
  });

  it("collects added lines per file from a zero-context diff", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1 +1,2 @@",
      "-old",
      "+new one",
      "+new two",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "-bye",
    ].join("\n");
    expect([...parseAddedLines(diff)]).toEqual([
      ["x.ts", ["new one", "new two"]],
    ]);
  });
});
