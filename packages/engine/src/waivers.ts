import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Waiver, WaiversSchema } from "@arynbht/factory-catalog";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { DAY_MS, endOfDayMs } from "./dates.js";
import { writeFileAtomic } from "./fs-atomic.js";

export class WaiverError extends Error {}

/** Load `.factory/waivers.yml` (missing → none; invalid → {@link WaiverError}). */
export async function loadWaivers(repoPath: string): Promise<Waiver[]> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoPath, ".factory", "waivers.yml"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new WaiverError(
      `waivers.yml is not valid YAML: ${(err as Error).message}`,
    );
  }
  if (parsed == null) return [];

  const result = WaiversSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new WaiverError(`waivers.yml is invalid: ${issues}`);
  }
  return result.data;
}

/** A waiver is active if its expiry (inclusive end of day) is valid and not past. */
export function isWaiverActive(waiver: Waiver, now: Date): boolean {
  const expiry = endOfDayMs(waiver.expires);
  return expiry !== null && now.getTime() <= expiry;
}

/** The active waiver for a control, or null. */
export function findActiveWaiver(
  waivers: Waiver[],
  controlId: string,
  now: Date,
): Waiver | null {
  return (
    waivers.find((w) => w.control === controlId && isWaiverActive(w, now)) ??
    null
  );
}

/** Active waivers whose expiry falls within `days` of `now`. */
export function waiversExpiringWithin(
  waivers: Waiver[],
  days: number,
  now: Date,
): Waiver[] {
  const horizon = now.getTime() + days * DAY_MS;
  return waivers.filter((w) => {
    const expiry = endOfDayMs(w.expires);
    return expiry !== null && expiry >= now.getTime() && expiry <= horizon;
  });
}

/** Add (or replace the same control's) waiver and write waivers.yml back. */
export async function addWaiver(
  repoPath: string,
  waiver: Waiver,
): Promise<Waiver[]> {
  const existing = await loadWaivers(repoPath);
  const next = [
    ...existing.filter((w) => w.control !== waiver.control),
    waiver,
  ];
  const result = WaiversSchema.safeParse(next);
  if (!result.success) {
    throw new WaiverError(`invalid waiver: ${result.error.issues[0]?.message}`);
  }
  await writeFileAtomic(
    resolve(repoPath, ".factory", "waivers.yml"),
    stringifyYaml(result.data),
  );
  return result.data;
}
