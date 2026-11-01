import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCatalog } from "./validate.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
);

describe("loadCatalog", () => {
  it("loads valid controls with no errors", async () => {
    const { controls, errors } = await loadCatalog(resolve(fixtures, "valid"));
    expect(errors).toEqual([]);
    expect(controls).toHaveLength(2);
    expect(controls.map((c) => c.id).sort()).toEqual([
      "repo.readme.present",
      "sec.secret-scanning.pre-commit",
    ]);
  });

  it("reports a control missing references", async () => {
    const { controls, errors } = await loadCatalog(
      resolve(fixtures, "missing-references"),
    );
    expect(controls).toEqual([]);
    expect(errors.some((e) => /reference/i.test(e.message))).toBe(true);
  });

  it("reports duplicate ids", async () => {
    const { errors } = await loadCatalog(resolve(fixtures, "duplicate-id"));
    expect(errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("reports malformed YAML", async () => {
    const { errors } = await loadCatalog(resolve(fixtures, "malformed"));
    expect(errors.some((e) => /YAML parse error/i.test(e.message))).toBe(true);
  });

  it("returns empty for a missing directory", async () => {
    const { controls, errors } = await loadCatalog(
      resolve(fixtures, "does-not-exist"),
    );
    expect(controls).toEqual([]);
    expect(errors).toEqual([]);
  });
});
