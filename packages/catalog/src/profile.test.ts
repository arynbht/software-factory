import { describe, expect, it } from "vitest";

import { ProfileSchema } from "./profile.js";

const base = {
  version: 1,
  name: "sample",
  type: "web-app",
};

describe("ProfileSchema", () => {
  it("accepts a minimal profile and applies defaults", () => {
    const result = ProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stack).toEqual([]);
      expect(result.data["severity-floor"]).toBe("low");
    }
  });

  it("accepts known flags and lane toggles", () => {
    const result = ProfileSchema.safeParse({
      ...base,
      flags: { "handles-pii": true, "public-facing": false },
      lanes: { legal: false },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown flag (typo protection)", () => {
    expect(
      ProfileSchema.safeParse({ ...base, flags: { "handles-pci": true } })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown project type", () => {
    expect(ProfileSchema.safeParse({ ...base, type: "webapp" }).success).toBe(
      false,
    );
  });

  it("requires version 1", () => {
    expect(ProfileSchema.safeParse({ ...base, version: 2 }).success).toBe(
      false,
    );
  });

  it("rejects unknown top-level keys", () => {
    expect(ProfileSchema.safeParse({ ...base, bogus: true }).success).toBe(
      false,
    );
  });
});
