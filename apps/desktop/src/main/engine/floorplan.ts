// Floor-plan adapter: load the persisted repository model, or run the deep-audit
// swarm to (re)build it. The swarm explores the repo with read-only Claude agents
// on the developer's subscription — so it needs the Claude CLI installed; when it
// isn't, `get`/`run` still return the last persisted model (if any) with
// `deepAuditAvailable: false` so the UI can explain why. Electron-free except the
// progress callback, which main wires to a push channel.
import {
  claudeCliAvailable,
  isStale,
  loadFloorPlan,
  runSwarm,
  saveArchitectureDoc,
  saveFloorPlan,
  type SwarmProgress,
} from "@arynbht/factory-engine";

import type { FloorPlanView } from "../../shared/ipc";

/**
 * Whether the deep-audit swarm can run. It spawns real `claude` processes, so
 * under the E2E seam (deterministic, offline tests) we report it unavailable — the
 * tests drive the Floor Plan from a seeded `.factory/floorplan.json` instead.
 */
function deepAuditAvailable(): Promise<boolean> {
  if (process.env.FACTORY_E2E === "1") return Promise.resolve(false);
  return claudeCliAvailable();
}

/** The last persisted model + whether a deep audit can run + staleness. */
export async function getFloorPlan(repoPath: string): Promise<FloorPlanView> {
  const [model, available] = await Promise.all([
    loadFloorPlan(repoPath),
    deepAuditAvailable(),
  ]);
  const stale = await isStale(repoPath, model);
  return { model, deepAuditAvailable: available, stale };
}

/**
 * Run the swarm, persist the model, and return it. Streams progress via
 * `onProgress`. If the Claude CLI is unavailable the swarm is skipped and the
 * persisted model (if any) is returned unchanged — the deterministic scorecard is
 * unaffected by this.
 */
export async function runFloorPlan(
  repoPath: string,
  onProgress: (p: SwarmProgress) => void,
  signal?: AbortSignal,
): Promise<FloorPlanView> {
  if (!(await deepAuditAvailable())) {
    const model = await loadFloorPlan(repoPath);
    return {
      model,
      deepAuditAvailable: false,
      stale: await isStale(repoPath, model),
    };
  }
  // Feed the prior model in so unchanged slices are reused (incremental refresh),
  // and run the bounded verification pass over the inferred cross-system edges.
  const previous = await loadFloorPlan(repoPath);
  const model = await runSwarm(repoPath, {
    onProgress,
    previous,
    verify: true,
    ...(signal ? { signal } : {}),
  });
  await saveFloorPlan(repoPath, model);
  // Also emit the human-readable architecture doc so it appears in the Docs tab.
  await saveArchitectureDoc(repoPath, model);
  return { model, deepAuditAvailable: true, stale: false };
}
