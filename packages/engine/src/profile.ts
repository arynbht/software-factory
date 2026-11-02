import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Profile, ProfileSchema } from "@arynbht/factory-catalog";
import {
  parse as parseYaml,
  parseDocument,
  stringify as stringifyYaml,
} from "yaml";

import { deepEqual } from "./detectors/path.js";

export class ProfileError extends Error {}

function validateProfile(profile: unknown): Profile {
  const result = ProfileSchema.safeParse(profile);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ProfileError(`invalid profile: ${issues}`);
  }
  return result.data;
}

/**
 * Load and validate `<repo>/.factory/profile.yml`. Returns null if there is no
 * profile (every control then applies); throws {@link ProfileError} if the file
 * is present but invalid, so the caller can surface a clear message.
 */
export async function loadProfile(repoPath: string): Promise<Profile | null> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoPath, ".factory", "profile.yml"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ProfileError(
      `profile.yml is not valid YAML: ${(err as Error).message}`,
    );
  }

  const result = ProfileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ProfileError(`profile.yml is invalid: ${issues}`);
  }
  return result.data;
}

/** Validate and write a profile to `<repo>/.factory/profile.yml` (full serialize). */
export async function saveProfile(
  repoPath: string,
  profile: unknown,
): Promise<Profile> {
  const validated = validateProfile(profile);
  const dir = resolve(repoPath, ".factory");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "profile.yml"),
    stringifyYaml(validated),
    "utf8",
  );
  return validated;
}

/**
 * Apply profile changes with a **minimal, comment-preserving** edit: only the
 * leaves that differ from the on-disk profile are written (yaml Document
 * round-trip), so toggling one flag yields a one-line diff. A flag/lane that is
 * absent on disk is already "off", so turning it off is a no-op (no `false` line
 * is added). When there is no file yet, writes a fresh full serialization.
 */
export async function updateProfile(
  repoPath: string,
  profile: unknown,
): Promise<Profile> {
  const validated = validateProfile(profile);
  const file = resolve(repoPath, ".factory", "profile.yml");

  let raw: string | null = null;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await mkdir(resolve(repoPath, ".factory"), { recursive: true });
  if (raw === null) {
    await writeFile(file, stringifyYaml(validated), "utf8");
    return validated;
  }

  const doc = parseDocument(raw, { keepSourceTokens: true });
  const parsedCurrent = ProfileSchema.safeParse(doc.toJS());
  const current = parsedCurrent.success ? parsedCurrent.data : null;

  // Compare against the parsed-current values (plain JS), not raw yaml nodes.
  const setIfChanged = (
    path: (string | number)[],
    next: unknown,
    currentValue: unknown,
  ): void => {
    if (!deepEqual(next, currentValue)) doc.setIn(path, next);
  };

  setIfChanged(["version"], validated.version, current?.version);
  setIfChanged(["name"], validated.name, current?.name);
  setIfChanged(["type"], validated.type, current?.type);
  setIfChanged(["stack"], validated.stack, current?.stack);
  if (validated.phase !== undefined) {
    setIfChanged(["phase"], validated.phase, current?.phase);
  }
  setIfChanged(
    ["severity-floor"],
    validated["severity-floor"],
    current?.["severity-floor"],
  );

  const applyToggles = (
    key: "flags" | "lanes",
    values: Record<string, boolean | undefined>,
    currentValues: Record<string, boolean | undefined> | undefined,
    defaultWhenAbsent: boolean,
  ): void => {
    for (const [name, value] of Object.entries(values)) {
      const onDisk = currentValues?.[name];
      // An absent toggle already has its default value, so don't add a redundant
      // line for it (flags default off; a lane absent here defaults to on).
      if (onDisk === undefined && value === defaultWhenAbsent) continue;
      if (!deepEqual(value, onDisk)) doc.setIn([key, name], value);
    }
  };

  applyToggles("flags", validated.flags, current?.flags, false);
  if (validated.lanes)
    applyToggles("lanes", validated.lanes, current?.lanes, true);

  await writeFile(file, doc.toString(), "utf8");
  return validated;
}
