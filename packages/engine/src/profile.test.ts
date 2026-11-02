import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadProfile,
  ProfileError,
  saveProfile,
  updateProfile,
} from "./profile.js";

/** Lines present in one string but not the other (ignoring blank lines). */
function lineDiff(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  return {
    added: b.filter((l) => !a.includes(l) && l.trim() !== ""),
    removed: a.filter((l) => !b.includes(l) && l.trim() !== ""),
  };
}

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

describe("updateProfile", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });
  async function repoWith(profileYml: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "factory-profile-"));
    made.push(dir);
    await mkdir(join(dir, ".factory"), { recursive: true });
    await writeFile(join(dir, ".factory", "profile.yml"), profileYml, "utf8");
    return dir;
  }

  it("toggles one flag with a one-line, comment-preserving diff", async () => {
    const original = [
      "# Factory profile for the repo.",
      "version: 1",
      "name: demo",
      "type: monorepo",
      "flags:",
      "  open-source: true",
      "  handles-pii: false",
      "severity-floor: medium",
      "",
    ].join("\n");
    const dir = await repoWith(original);
    const profile = await loadProfile(dir);
    expect(profile).not.toBeNull();

    await updateProfile(dir, {
      ...profile!,
      flags: { ...profile!.flags, "open-source": false },
    });

    const after = await readFile(join(dir, ".factory", "profile.yml"), "utf8");
    expect(after).toContain("# Factory profile for the repo."); // comment kept
    const diff = lineDiff(original, after);
    expect(diff.added).toEqual(["  open-source: false"]);
    expect(diff.removed).toEqual(["  open-source: true"]);
  });

  it("does not add a false line for a flag that was absent", async () => {
    const dir = await repoWith(
      "version: 1\nname: demo\ntype: cli\nflags:\n  open-source: true\n",
    );
    const profile = await loadProfile(dir);
    await updateProfile(dir, {
      ...profile!,
      flags: { ...profile!.flags, "handles-pii": false },
    });
    const after = await readFile(join(dir, ".factory", "profile.yml"), "utf8");
    expect(after).not.toContain("handles-pii");
  });

  it("creates a fresh profile when none exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-profile-"));
    made.push(dir);
    await updateProfile(dir, { version: 1, name: "fresh", type: "cli" });
    expect((await loadProfile(dir))?.name).toBe("fresh");
  });
});
