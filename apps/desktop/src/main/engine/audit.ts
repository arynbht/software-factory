// The audit adapter: the main process calls the headless engine directly (not the
// CLI) and shapes a lane-grouped scorecard for the renderer. This mirrors what
// `factory audit <path>` does — load the bundled catalog, apply the profile's
// severity-floor, evaluate every applicable control — and joins each result with
// its control so the UI can show rationale + references on expand.
import {
  LANES,
  loadBundledCatalog,
  SEVERITIES,
  type Control,
} from "@arynbht/factory-catalog";
import {
  buildContext,
  type ControlResult,
  evaluateControls,
} from "@arynbht/factory-engine";

import {
  type Scorecard,
  type ScorecardControl,
  type ScorecardLane,
  type StatusCounts,
} from "../../shared/ipc";

function emptyCounts(): StatusCounts {
  return { pass: 0, fail: 0, needsEvidence: 0, waived: 0, skip: 0, na: 0 };
}

function bump(counts: StatusCounts, status: ControlResult["status"]): void {
  switch (status) {
    case "pass":
      counts.pass += 1;
      break;
    case "fail":
      counts.fail += 1;
      break;
    case "needs-evidence":
      counts.needsEvidence += 1;
      break;
    case "waived":
      counts.waived += 1;
      break;
    case "skip":
      counts.skip += 1;
      break;
    case "n/a":
      counts.na += 1;
      break;
  }
}

/** The most useful one-line message for a control result. */
function summarize(result: ControlResult): string {
  const failing = result.detectors.find((d) => d.status === "fail");
  if (failing) return failing.message;
  if (result.status === "waived" && result.waiver) {
    return `waived: ${result.waiver.reason}`;
  }
  const skipped = result.detectors.find((d) => d.status === "skip");
  if (skipped) return skipped.message;
  return result.detectors[0]?.message ?? "";
}

/** Run an audit over a local repo and return the lane scorecard. */
export async function runAudit(repoPath: string): Promise<Scorecard> {
  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    throw new Error(
      `Catalog is invalid: ${errors[0]?.message ?? "unknown error"}`,
    );
  }

  // No token yet (device-flow auth lands in M5.3), so github-api detectors skip.
  const ctx = buildContext(repoPath, {});
  const profile = await ctx.profile().catch(() => null);
  const waivers = await ctx.waivers().catch(() => []);

  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const selected = controls.filter(
    (c) => SEVERITIES.indexOf(c.severity) <= floorRank,
  );
  const byId = new Map<string, Control>(selected.map((c) => [c.id, c]));

  const results = await evaluateControls(selected, ctx, { profile, waivers });

  // Prime every lane in catalog order; drop the empty ones at the end.
  const lanes = new Map<string, ScorecardLane>();
  for (const lane of LANES) {
    lanes.set(lane.key, {
      key: lane.key,
      title: lane.title,
      counts: emptyCounts(),
      controls: [],
    });
  }
  const totals: StatusCounts & { total: number } = {
    ...emptyCounts(),
    total: results.length,
  };

  for (const result of results) {
    const lane = lanes.get(result.lane);
    if (!lane) continue;
    const control = byId.get(result.controlId);
    const entry: ScorecardControl = {
      controlId: result.controlId,
      title: result.title,
      status: result.status,
      severity: result.severity,
      message: summarize(result),
      rationale: control?.rationale ?? "",
      references: (control?.references ?? []).map((ref) => ({
        name: ref.name,
        url: ref.url,
        ...(ref.section ? { section: ref.section } : {}),
      })),
    };
    lane.controls.push(entry);
    bump(lane.counts, result.status);
    bump(totals, result.status);
  }

  return {
    repoPath,
    generatedAt: new Date().toISOString(),
    totals,
    lanes: [...lanes.values()].filter((lane) => lane.controls.length > 0),
  };
}
