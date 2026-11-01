import { readdir } from "node:fs/promises";

import {
  bundledTemplatesDir,
  loadBundledCatalog,
  type Profile,
} from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import { renderTemplate, templateVars } from "./template.js";

const profile = (over: Partial<Profile> = {}): Profile =>
  ({
    version: 1,
    name: "demo",
    type: "cli",
    stack: [],
    flags: {},
    "severity-floor": "low",
    ...over,
  }) as Profile;

describe("renderTemplate", () => {
  it("renders every shipped template without error", async () => {
    const names = (
      await readdir(bundledTemplatesDir(), { withFileTypes: true })
    )
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(names.length).toBeGreaterThan(5);

    for (const name of names) {
      const changes = await renderTemplate(
        name,
        templateVars(profile(), 2026),
        "c.x.y",
      );
      expect(changes.length).toBeGreaterThan(0);
      for (const change of changes) {
        expect(change.type).toBe("file");
        if (change.type === "file") {
          expect(change.path).not.toMatch(/\.eta$/);
          expect(change.path).not.toMatch(/^(node|python|common)\//);
          expect(change.contents.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("substitutes profile variables", async () => {
    const changes = await renderTemplate(
      "license",
      templateVars(profile({ name: "Acme" }), 2026),
      "repo.license.present",
    );
    const license = changes.find(
      (c) => c.type === "file" && c.path === "LICENSE",
    );
    expect(license?.type === "file" && license.contents).toContain(
      "Copyright (c) 2026 Acme",
    );
  });

  it("selects stack-specific files (node vs python)", async () => {
    const node = await renderTemplate(
      "linter",
      templateVars(profile({ stack: ["typescript"] }), 2026),
      "dev.linter.configured",
    );
    expect(
      node.some((c) => c.type === "file" && c.path === "eslint.config.js"),
    ).toBe(true);

    const py = await renderTemplate(
      "linter",
      templateVars(profile({ stack: ["python"] }), 2026),
      "dev.linter.configured",
    );
    expect(py.some((c) => c.type === "file" && c.path === "ruff.toml")).toBe(
      true,
    );
    expect(
      py.some((c) => c.type === "file" && c.path === "eslint.config.js"),
    ).toBe(false);
  });

  it("every fix:template control points to a template dir that renders", async () => {
    const { controls } = await loadBundledCatalog();
    const names = new Set(
      (await readdir(bundledTemplatesDir(), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
    for (const control of controls) {
      if (control.fix?.type === "template") {
        expect(names.has(control.fix.template)).toBe(true);
      }
    }
  });
});
