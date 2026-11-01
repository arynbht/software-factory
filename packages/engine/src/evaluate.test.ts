import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Control, DetectorConfig } from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import { buildContext } from "./context.js";
import { runDetector } from "./detectors/run.js";
import { evaluateControl } from "./evaluate.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
);

function control(detect: DetectorConfig[]): Control {
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
  } as Control;
}

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
});
