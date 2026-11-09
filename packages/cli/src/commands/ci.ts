import { readFile, writeFile } from "node:fs/promises";

import {
  loadBundledCatalog,
  loadBundledGates,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  appendHistory,
  buildContext,
  evaluateControls,
  evaluateGate,
  EvidenceError,
  evidenceExpiringWithin,
  type GateStatus,
  laneCounts,
  Octokit,
  QUIET_LOG,
  ProfileError,
  resolveToken,
  upsertStatusIssue,
  upsertStickyComment,
  WaiverError,
  waiversExpiringWithin,
} from "@arynbht/factory-engine";

import { today } from "../dates.js";
import { renderReport } from "../report.js";

interface EventPayload {
  pull_request?: { number?: number };
  number?: number;
}

async function readPrNumber(): Promise<number | null> {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  try {
    const payload = JSON.parse(await readFile(path, "utf8")) as EventPayload;
    return payload.pull_request?.number ?? payload.number ?? null;
  } catch {
    return null;
  }
}

/** Fail the job only on a pull request with a red gate. */
export function exitCodeForCi(isPr: boolean, gateStatus: GateStatus): number {
  return isPr && gateStatus === "red" ? 1 : 0;
}

/**
 * `factory ci` — the GitHub Action entrypoint, driven by `GITHUB_*` env vars.
 * Audits the checked-out repo, writes the report to the job summary, and either
 * posts a sticky PR comment (failing on a red gate) or maintains a "Factory
 * status" issue on a scheduled run (never failing). See ADR-0006.
 */
export async function runCi(): Promise<number> {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  const token = resolveToken(process.env.GITHUB_TOKEN);
  const gateName = process.env.FACTORY_GATE || "build";
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const now = new Date();

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`::error::Catalog is invalid (${errors.length} error(s)).`);
    for (const err of errors)
      console.error(`::error::${err.file}: ${err.message}`);
    return 1;
  }

  const { gates } = await loadBundledGates();
  const gate = gates.find((g) => g.phase === gateName);
  if (!gate) {
    // Fail closed: a misconfigured gate must not let a PR pass unaudited.
    console.error(
      `::error::factory ci: unknown gate "${gateName}". Defined gates: ${gates
        .map((g) => g.phase)
        .join(", ")}.`,
    );
    return 1;
  }

  const ctx = buildContext(workspace, {
    token,
    github: owner && repo ? { owner, repo } : undefined,
  });

  let profile;
  let waivers;
  let evidence;
  try {
    profile = await ctx.profile();
    waivers = await ctx.waivers();
    evidence = await ctx.evidence();
  } catch (err) {
    if (
      err instanceof ProfileError ||
      err instanceof WaiverError ||
      err instanceof EvidenceError
    ) {
      console.error(`::error::factory ci: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const all = await evaluateControls(controls, ctx, { profile, waivers });
  // `severity-floor` trims what the report shows; the gate is always judged on
  // every control, so a profile edit can't turn CI green.
  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const results = all.filter(
    (r) => SEVERITIES.indexOf(r.severity) <= floorRank,
  );

  // Annotations into the workflow log.
  process.stdout.write(`${renderReport(results, { format: "github" })}\n`);

  // Append a per-lane pass snapshot for the hygiene trend (best-effort).
  await appendHistory(workspace, {
    date: today(now),
    byLane: laneCounts(all),
  }).catch(() => undefined);

  const gateResult = evaluateGate(gate, all);
  // Name the gate's blockers explicitly: one may sit below the severity floor and
  // so be missing from the report table above.
  const blocking = gateResult.controls
    .filter((c) => c.status === "fail")
    .map((c) => `\`${c.controlId}\``);
  const gateLine =
    `\n\n**${gateResult.title ?? `${gateName} gate`}: ${gateResult.status.toUpperCase()}**` +
    (blocking.length > 0 ? ` — failing: ${blocking.join(", ")}` : "");

  const expiring = [
    ...waiversExpiringWithin(waivers, 30, now).map(
      (w) => `waiver \`${w.control}\``,
    ),
    ...evidenceExpiringWithin(evidence, 30, now).map(
      (e) => `evidence \`${e.control}\``,
    ),
  ];
  const expiryLine =
    expiring.length > 0
      ? `\n\n⚠ Expiring within 30 days: ${expiring.join(", ")}`
      : "";

  const body = `${renderReport(results, { format: "markdown" })}${gateLine}${expiryLine}`;

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`, {
      flag: "a",
    });
  }

  const prNumber = await readPrNumber();
  const isPr = prNumber !== null;

  if (!owner || !repo || !token) {
    console.error(
      "::warning::factory ci: GITHUB_REPOSITORY and a token are required to comment or open issues.",
    );
    return exitCodeForCi(isPr, gateResult.status);
  }
  const octokit = new Octokit({ auth: token, log: QUIET_LOG });

  if (isPr) {
    try {
      await upsertStickyComment(octokit, owner, repo, prNumber, body);
    } catch (err) {
      console.error(
        `::warning::factory ci: could not post PR comment: ${(err as Error).message}`,
      );
    }
    return exitCodeForCi(true, gateResult.status);
  }

  // schedule / push / dispatch: the status issue is the signal; never fail.
  try {
    await upsertStatusIssue(
      octokit,
      owner,
      repo,
      body,
      gateResult.status === "green",
    );
  } catch (err) {
    console.error(
      `::warning::factory ci: could not update status issue: ${(err as Error).message}`,
    );
  }
  return 0;
}
