import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Profile, ProfileSchema } from "@arynbht/factory-catalog";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export class ProfileError extends Error {}

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

/** Validate and write a profile to `<repo>/.factory/profile.yml`. */
export async function saveProfile(
  repoPath: string,
  profile: unknown,
): Promise<Profile> {
  const result = ProfileSchema.safeParse(profile);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ProfileError(`invalid profile: ${issues}`);
  }
  const dir = resolve(repoPath, ".factory");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "profile.yml"),
    stringifyYaml(result.data),
    "utf8",
  );
  return result.data;
}
