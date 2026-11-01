import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Control,
  DetectorConfig,
  Profile,
} from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import type { AuditContext } from "./context.js";
import { buildContext } from "./context.js";
import { runDetector } from "./detectors/run.js";
import { evaluateControl } from "./evaluate.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
);

function control(
  detect: DetectorConfig[],
  overrides: Partial<Control> = {},
): Control {
  return {
    id: "repo.readme.present",
    title: "README present",
    lane: "hygiene",
    phase: "scaffold",
    severity: "medium",
    detect,
    evidence: "none",
    references: [{ name: "ref", url: "https://example.com" }],
    rationale: "because",
    ...overrides,
  } as Control;
}

const NOW = new Date("2026-11-01T00:00:00Z");

describe("runDetector", () => {
  it("skips an unknown detector type (defensive)", async () => {
    const ctx = buildContext(resolve(fixtures, "empty"));
    const result = await runDetector(ctx, {
      type: "not-a-real-detector",
    } as unknown as DetectorConfig);
    expect(result.status).toBe("skip");
    expect(result.message).toMatch(/not implemented/i);
  });
});

describe("evaluateControl", () => {
  it("fails a control when any detector fails", async () => {
    const ctx = buildContext(resolve(fixtures, "empty"));
    const result = await evaluateControl(
      control([{ type: "file-exists", path: "README.md" }]),
      ctx,
    );
    expect(result.status).toBe("fail");
    expect(result.detectors).toHaveLength(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes when all detectors pass", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await evaluateControl(
      control([
        { type: "file-exists", path: "README.md" },
        { type: "file-matches", path: "README.md", pattern: "(?i)setup" },
      ]),
      ctx,
    );
    expect(result.status).toBe("pass");
  });

  it("is skip (undetermined) when a detector skips and none fail", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await evaluateControl(
      control([
        { type: "file-exists", path: "README.md" },
        { type: "github-api", check: "branch-protection" },
      ]),
      ctx,
    );
    expect(result.status).toBe("skip");
  });

  it("marks a non-applicable control n/a without running detectors", async () => {
    const ctx = buildContext(resolve(fixtures, "empty"));
    const profile = {
      version: 1,
      name: "x",
      type: "cli",
      stack: [],
      flags: { "handles-pii": false },
      "severity-floor": "low",
    } as unknown as Profile;
    const result = await evaluateControl(
      control([{ type: "file-exists", path: "README.md" }], {
        applies: { flag: "handles-pii" },
      }),
      ctx,
      { profile },
    );
    expect(result.status).toBe("n/a");
    expect(result.detectors).toHaveLength(0);
  });

  it("needs-evidence for a manual control with no valid evidence", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await evaluateControl(
      control([{ type: "manual" }], { id: "a11y.screen-reader-pass" }),
      ctx,
      { now: NOW },
    );
    expect(result.status).toBe("needs-evidence");
  });

  it("passes a manual control with valid evidence", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await evaluateControl(
      control([{ type: "manual" }], {
        id: "sec.threat-model",
        lane: "security",
      }),
      ctx,
      { now: NOW },
    );
    expect(result.status).toBe("pass");
  });

  it("treats an unreadable evidence file as needs-evidence, not a crash", async () => {
    const brokenCtx: AuditContext = {
      repoPath: "/virtual",
      token: undefined,
      glob: async () => [],
      readFile: async () => null,
      github: async () => null,
      evidence: async () => {
        throw new Error("evidence.yml unreadable");
      },
    };
    const result = await evaluateControl(
      control([{ type: "manual" }], {
        id: "sec.threat-model",
        lane: "security",
      }),
      brokenCtx,
      { now: NOW },
    );
    expect(result.status).toBe("needs-evidence");
  });

  it("fails when an automated detector fails even if evidence is valid", async () => {
    const ctx = buildContext(resolve(fixtures, "node-complete"));
    const result = await evaluateControl(
      control([{ type: "manual" }, { type: "file-exists", path: "NOPE.md" }], {
        id: "sec.threat-model",
        lane: "security",
      }),
      ctx,
      { now: NOW },
    );
    expect(result.status).toBe("fail");
  });
});
