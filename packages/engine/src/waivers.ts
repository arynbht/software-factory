import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Waiver, WaiversSchema } from "@arynbht/factory-catalog";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export class WaiverError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A waiver is active if its expiry date is valid and not in the past. */
export function isWaiverActive(waiver: Waiver, now: Date): boolean {
  const expiry = new Date(waiver.expires);
  if (Number.isNaN(expiry.getTime())) return false;
  return now.getTime() <= expiry.getTime();
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
    const expiry = new Date(w.expires).getTime();
    return (
      !Number.isNaN(expiry) && expiry >= now.getTime() && expiry <= horizon
    );
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
  const dir = resolve(repoPath, ".factory");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "waivers.yml"),
    stringifyYaml(result.data),
    "utf8",
  );
  return result.data;
}
