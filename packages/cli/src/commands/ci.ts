import { readFile, writeFile } from "node:fs/promises";

import {
  loadBundledCatalog,
  loadBundledGates,
  SEVERITIES,
} from "@arynbht/factory-catalog";
import {
  buildContext,
  evaluateControls,
  evaluateGate,
  Octokit,
  resolveToken,
  upsertStatusIssue,
  upsertStickyComment,
} from "@arynbht/factory-engine";

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

/**
 * `factory ci` — the GitHub Action entrypoint. Audits the checked-out repo,
 * writes the report to the job summary, and either posts a sticky PR comment
 * (failing the job on a red gate) or maintains a "Factory status" issue on a
 * scheduled run (never failing the job). Driven entirely by GitHub env vars.
 */
export async function runCi(): Promise<number> {
  const event = process.env.GITHUB_EVENT_NAME ?? "";
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  const token = resolveToken(process.env.GITHUB_TOKEN);
  const gateName = process.env.FACTORY_GATE || "build";
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const { controls, errors } = await loadBundledCatalog();
  if (errors.length > 0) {
    console.error(`Catalog is invalid (${errors.length} error(s)).`);
    return 1;
  }
  const { gates } = await loadBundledGates();
  const gate = gates.find((g) => g.phase === gateName);

  const ctx = buildContext(workspace, {
    token,
    github: owner && repo ? { owner, repo } : undefined,
  });
  const profile = await ctx.profile().catch(() => null);
  const waivers = await ctx.waivers().catch(() => []);
  const floorRank = SEVERITIES.indexOf(profile?.["severity-floor"] ?? "low");
  const selected = controls.filter(
    (c) => SEVERITIES.indexOf(c.severity) <= floorRank,
  );
  const results = await evaluateControls(selected, ctx, { profile, waivers });

  // Annotations into the workflow log.
  process.stdout.write(`${renderReport(results, { format: "github" })}\n`);

  const gateResult = gate ? evaluateGate(gate, results) : null;
  const gateLine = gateResult
    ? `\n\n**${gateResult.title ?? `${gateName} gate`}: ${gateResult.status.toUpperCase()}**`
    : "";
  const body = `${renderReport(results, { format: "markdown" })}${gateLine}`;

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`, {
      flag: "a",
    });
  }

  const red = gateResult?.status === "red";

  if (!owner || !repo || !token) {
    console.error(
      "factory ci: GITHUB_REPOSITORY and a token are required to comment or open issues.",
    );
    return red ? 1 : 0;
  }
  const octokit = new Octokit({ auth: token });

  if (event === "pull_request") {
    const prNumber = await readPrNumber();
    if (prNumber) {
      try {
        await upsertStickyComment(octokit, owner, repo, prNumber, body);
      } catch (err) {
        console.error(
          `factory ci: could not post PR comment: ${(err as Error).message}`,
        );
      }
    }
    // PRs are the enforcement point.
    return red ? 1 : 0;
  }

  // schedule / push / workflow_dispatch: the status issue is the signal; never fail.
  const allGreen = !gateResult || gateResult.status === "green";
  try {
    await upsertStatusIssue(octokit, owner, repo, body, allGreen);
  } catch (err) {
    console.error(
      `factory ci: could not update status issue: ${(err as Error).message}`,
    );
  }
  return 0;
}
