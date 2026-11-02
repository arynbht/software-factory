import { describe, expect, it } from "vitest";

import { ControlSchema, DetectorConfigSchema } from "./schema.js";

const base = {
  id: "repo.readme.present",
  title: "README present",
  lane: "hygiene",
  phase: "scaffold",
  severity: "medium",
  detect: [{ type: "file-exists", path: "README.md" }],
  references: [{ name: "OpenSSF Scorecard", url: "https://example.com" }],
  rationale: "Because a README is the first thing a contributor reads.",
};

describe("ControlSchema", () => {
  it("accepts a valid control and defaults evidence to none", () => {
    const result = ControlSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.evidence).toBe("none");
  });

  it("rejects a control with no references", () => {
    const withoutReferences = { ...base } as Partial<typeof base>;
    delete withoutReferences.references;
    expect(ControlSchema.safeParse(withoutReferences).success).toBe(false);
  });

  it("rejects an empty rationale", () => {
    expect(ControlSchema.safeParse({ ...base, rationale: "" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed id", () => {
    expect(ControlSchema.safeParse({ ...base, id: "BadID" }).success).toBe(
      false,
    );
  });

  it("rejects an id prefix that does not match the lane code", () => {
    // lane "hygiene" has code "repo"; "dev." is the development lane's code.
    expect(
      ControlSchema.safeParse({ ...base, id: "dev.readme.present" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict object)", () => {
    expect(ControlSchema.safeParse({ ...base, bogus: true }).success).toBe(
      false,
    );
  });

  it("requires at least one detector", () => {
    expect(ControlSchema.safeParse({ ...base, detect: [] }).success).toBe(
      false,
    );
  });

  it("rejects a merge fix with no value (silent no-op)", () => {
    const noValue = {
      ...base,
      fix: { type: "merge-yaml", file: "ci.yml", path: "jobs" },
    };
    expect(ControlSchema.safeParse(noValue).success).toBe(false);
  });

  it("accepts a merge fix that specifies a value", () => {
    const withValue = {
      ...base,
      fix: {
        type: "merge-yaml",
        file: "ci.yml",
        path: "permissions",
        value: { contents: "read" },
      },
    };
    expect(ControlSchema.safeParse(withValue).success).toBe(true);
  });
});

describe("DetectorConfigSchema", () => {
  it("accepts every detector type", () => {
    const configs = [
      { type: "file-exists", path: "README.md" },
      { type: "file-matches", path: "README.md", pattern: "setup" },
      { type: "file-json-path", file: "package.json", path: "scripts.build" },
      { type: "file-yaml-path", file: "ci.yml", path: "jobs.ci" },
      { type: "github-api", check: "branch-protection" },
      { type: "command", run: "scorecard --format json" },
      { type: "scorecard", check: "Token-Permissions", min: 7 },
      { type: "manual" },
    ];
    for (const config of configs) {
      expect(DetectorConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  it("rejects an unknown detector type", () => {
    expect(DetectorConfigSchema.safeParse({ type: "nope" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown github-api check", () => {
    expect(
      DetectorConfigSchema.safeParse({ type: "github-api", check: "bogus" })
        .success,
    ).toBe(false);
  });
});
