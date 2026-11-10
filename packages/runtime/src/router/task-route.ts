// The route beat for a task (§3.2): propose an assembly from the confirmed
// card, then a human approves it — the second and last approval before the
// agent starts. Approval seals the assembly's hash in the ledger, so a later
// edit to assembly.yml is caught like an edit to the card.
import { readFile, writeFile } from "node:fs/promises";

import { buildContext } from "@arynbht/factory-engine";
import {
  loadManifests,
  lockDigest,
  readLock,
  readState,
} from "@arynbht/factory-registry";
import { simpleGit } from "simple-git";
import { parse, stringify } from "yaml";

import { changeChecks } from "../judge/tier1.js";
import {
  assemblyPath,
  loadTask,
  sha256,
  type Task,
  TaskError,
} from "../task/tasks.js";
import {
  type Assembly,
  route,
  type RouteInput,
  type Routing,
  validateAssembly,
} from "./route.js";

const PROPOSED = /^assembly proposed; sha256 ([0-9a-f]{64})/;

export type RouteContext = Omit<RouteInput, "card">;

/**
 * What the router reads from the repo: manifests, the skills a sync left
 * loadable, the profile's flags, the tracked files, and the judge's checks.
 * Refuses when the skills are stale (§3.0: the pipeline doesn't start then).
 */
export async function routingContext(
  repoPath: string,
  options: { bundledDir?: string | undefined } = {},
): Promise<RouteContext> {
  const { manifests, errors } = await loadManifests(
    repoPath,
    ...(options.bundledDir ? [options.bundledDir] : []),
  );
  if (errors.length > 0) {
    throw new TaskError(
      `skill manifests have problems:\n${errors.map((e) => `  - ${e.name}: ${e.message}`).join("\n")}`,
    );
  }
  const lock = await readLock(repoPath);
  const state = await readState(repoPath);
  if (lock.skills.length > 0) {
    if (!state)
      throw new TaskError(
        "skills have never been synced: run `factory skills sync`",
      );
    if (state.lock !== (await lockDigest(repoPath)))
      throw new TaskError(
        "the skills lock changed since the last sync: run `factory skills sync`",
      );
  }
  const profile = await buildContext(repoPath)
    .profile()
    .catch(() => null);
  const files = (
    await simpleGit(repoPath)
      .raw(["ls-files"])
      .catch(() => "")
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return {
    manifests,
    available: new Set(state?.skills.map((s) => s.name) ?? []),
    flags: profile?.flags ?? {},
    files,
    checks: (await changeChecks()).map((c) => c.id),
  };
}

function ready(task: Task): void {
  if (task.problems.length > 0) {
    throw new TaskError(
      `task ${task.card.id} fails verification:\n${task.problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  if (!task.confirmed)
    throw new TaskError(
      `task ${task.card.id} isn't confirmed yet: \`factory task confirm ${task.card.id}\``,
    );
  if (task.approved)
    throw new TaskError(`task ${task.card.id}'s route is already approved`);
}

const HEADER =
  "# Proposed by `factory task route`. Edit it if you disagree, then\n" +
  "# `factory task approve`: approval re-checks it and seals it in the ledger.\n";

/**
 * `factory task route <id>`: route the confirmed card, write assembly.yml, and
 * record why in the ledger. Routing again before approval replaces the proposal.
 */
export async function routeTask(
  repoPath: string,
  id: string,
  options: {
    by: string;
    now?: Date | undefined;
    context?: RouteContext | undefined;
  },
): Promise<{ task: Task; routing: Routing }> {
  const task = await loadTask(repoPath, id);
  ready(task);
  const context = options.context ?? (await routingContext(repoPath));
  const routing = route({ ...context, card: task.card });
  const text = `${HEADER}${stringify(routing.assembly)}`;
  await writeFile(assemblyPath(repoPath, id), text, "utf8");

  const a = routing.assembly;
  const entry = (text: string, section: "decision" | "timeline") =>
    task.ledger.append({
      beat: "route",
      section,
      text,
      by: `factory router (for ${options.by})`,
      at: options.now,
    });
  await entry(
    `routed to ${a.sectors.join(", ") || "no sector"}: ${routing.scores
      .filter((s) => a.sectors.includes(s.sector))
      .map((s) => `${s.sector} (${s.reasons.join("; ")})`)
      .join(", ")}`,
    "decision",
  );
  if (routing.borderline.length > 0)
    await entry(
      `under the threshold, for the approver: ${routing.borderline.join(", ")}`,
      "decision",
    );
  for (const note of [...routing.notes, ...a.gaps])
    await entry(note, "decision");
  await entry(
    `assembly proposed; sha256 ${sha256(text)}; skills ${a.skills.join(", ") || "none"}; proof ${a.proof}; awaiting approval`,
    "timeline",
  );
  return { task: await loadTask(repoPath, id), routing };
}

/**
 * `factory task approve <id>`: a person agrees the assembly. Re-validates it
 * (it may have been edited), records an edit, and seals its hash.
 */
export async function approveRoute(
  repoPath: string,
  id: string,
  options: {
    by: string;
    now?: Date | undefined;
    context?: RouteContext | undefined;
  },
): Promise<{ task: Task; assembly: Assembly }> {
  const task = await loadTask(repoPath, id);
  ready(task);
  const text = await readFile(assemblyPath(repoPath, id), "utf8").catch(
    () => undefined,
  );
  if (text === undefined)
    throw new TaskError(
      `task ${id} hasn't been routed: \`factory task route ${id}\``,
    );
  const context = options.context ?? (await routingContext(repoPath));
  let input: unknown;
  try {
    input = parse(text);
  } catch (err) {
    throw new TaskError(
      `assembly.yml isn't valid YAML: ${(err as Error).message}`,
    );
  }
  const { assembly, problems } = validateAssembly(input, {
    task: id,
    manifests: context.manifests,
    available: context.available,
    checks: context.checks,
  });
  if (!assembly) {
    throw new TaskError(
      `assembly.yml can't be approved:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  const proposed = task.entries
    .map((e) => PROPOSED.exec(e.text)?.[1])
    .filter((h): h is string => h !== undefined)
    .pop();
  if (proposed !== sha256(text)) {
    await task.ledger.append({
      beat: "route",
      section: "decision",
      text: `assembly edited before approval: skills ${assembly.skills.join(", ") || "none"}; proof ${assembly.proof}`,
      by: options.by,
      at: options.now,
    });
  }
  await task.ledger.append({
    beat: "route",
    section: "timeline",
    text: `route approved; assembly sha256 ${sha256(text)}`,
    by: options.by,
    at: options.now,
  });
  return { task: await loadTask(repoPath, id), assembly };
}
