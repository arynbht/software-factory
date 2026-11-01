import { resolve } from "node:path";

import type { Profile } from "@arynbht/factory-catalog";
import {
  loadProfile,
  ProfileError,
  saveProfile,
} from "@arynbht/factory-engine";

/** `factory profile show` — print the resolved profile. */
export async function runProfileShow(path: string): Promise<number> {
  const root = resolve(path);
  let profile: Profile | null;
  try {
    profile = await loadProfile(root);
  } catch (err) {
    console.error(err instanceof ProfileError ? err.message : String(err));
    return 1;
  }
  if (!profile) {
    console.error(
      "No .factory/profile.yml found. Run `factory init` to create one.",
    );
    return 1;
  }
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
  return 0;
}

/** `factory profile set <key> <value>` — update one field and write it back. */
export async function runProfileSet(
  key: string,
  value: string,
  path: string,
): Promise<number> {
  const root = resolve(path);
  let profile: Profile | null;
  try {
    profile = await loadProfile(root);
  } catch (err) {
    console.error(err instanceof ProfileError ? err.message : String(err));
    return 1;
  }
  if (!profile) {
    console.error(
      "No .factory/profile.yml found. Run `factory init` to create one.",
    );
    return 1;
  }

  const draft: Record<string, unknown> = { ...profile };
  const bool = (v: string): boolean => v === "true";

  if (key === "name" || key === "type" || key === "phase") {
    draft[key] = value;
  } else if (key === "severity-floor") {
    draft["severity-floor"] = value;
  } else if (key === "stack") {
    draft["stack"] = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (key.startsWith("flags.")) {
    draft["flags"] = { ...(profile.flags ?? {}), [key.slice(6)]: bool(value) };
  } else if (key.startsWith("lanes.")) {
    draft["lanes"] = { ...(profile.lanes ?? {}), [key.slice(6)]: bool(value) };
  } else {
    console.error(
      `Unknown profile key "${key}". Try: name, type, phase, severity-floor, stack, flags.<flag>, lanes.<lane>.`,
    );
    return 1;
  }

  try {
    await saveProfile(root, draft);
  } catch (err) {
    console.error(err instanceof ProfileError ? err.message : String(err));
    return 1;
  }
  process.stdout.write(`Set ${key} = ${value}\n`);
  return 0;
}
