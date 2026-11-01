import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadProfile, ProfileError, saveProfile } from "./profile.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
);

describe("loadProfile", () => {
  it("loads and validates a profile", async () => {
    const profile = await loadProfile(resolve(fixtures, "profile-valid"));
    expect(profile?.type).toBe("web-app");
    expect(profile?.flags["public-facing"]).toBe(true);
    expect(profile?.["severity-floor"]).toBe("medium");
  });

  it("returns null when there is no profile", async () => {
    expect(await loadProfile(resolve(fixtures, "empty"))).toBeNull();
  });

  it("throws ProfileError on an invalid profile", async () => {
    await expect(
      loadProfile(resolve(fixtures, "profile-invalid")),
    ).rejects.toBeInstanceOf(ProfileError);
  });
});

describe("saveProfile", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });

  it("writes a valid profile that round-trips through loadProfile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-profile-"));
    made.push(dir);
    await saveProfile(dir, { version: 1, name: "x", type: "cli" });
    const written = await readFile(
      join(dir, ".factory", "profile.yml"),
      "utf8",
    );
    expect(written).toContain("type: cli");
    expect((await loadProfile(dir))?.name).toBe("x");
  });

  it("rejects an invalid profile without writing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-profile-"));
    made.push(dir);
    await expect(
      saveProfile(dir, { version: 1, name: "x", type: "nope" }),
    ).rejects.toBeInstanceOf(ProfileError);
  });
});
