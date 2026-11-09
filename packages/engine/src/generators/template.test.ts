import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundledTemplatesDir,
  type Control,
  loadBundledCatalog,
  type Profile,
} from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { renderTemplate, templateGenerator, templateVars } from "./template.js";

const cleanup: string[] = [];
afterEach(async () => {
  for (const d of cleanup) await rm(d, { recursive: true, force: true });
  cleanup.length = 0;
});

const profile = (over: Partial<Profile> = {}): Profile =>
  ({
    version: 1,
    name: "demo",
    type: "cli",
    stack: [],
    flags: {},
    "severity-floor": "low",
    project: {
      license: "MIT",
      owner: "@acme",
      "security-contact": "security@acme.test",
    },
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
        templateVars(profile({ stack: ["typescript"] }), 2026),
        "c.x.y",
      );
      expect(changes.length).toBeGreaterThan(0);
      for (const change of changes) {
        expect(change.type).toBe("file");
        if (change.type === "file") {
          expect(change.path).not.toMatch(/\.eta$/);
          expect(change.path).not.toMatch(/^(node|python|go|rust|common)\//);
          expect(change.contents).not.toMatch(/@OWNER|security@example\.com/);
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

  it("pins the toolchain per stack (.nvmrc for node, .python-version for python)", async () => {
    const node = await renderTemplate(
      "toolchain",
      templateVars(profile({ stack: ["typescript"] }), 2026),
      "repo.toolchain-pinned",
    );
    expect(node.some((c) => c.type === "file" && c.path === ".nvmrc")).toBe(
      true,
    );
    expect(
      node.some((c) => c.type === "file" && c.path === ".python-version"),
    ).toBe(false);

    const py = await renderTemplate(
      "toolchain",
      templateVars(profile({ stack: ["python"] }), 2026),
      "repo.toolchain-pinned",
    );
    expect(
      py.some((c) => c.type === "file" && c.path === ".python-version"),
    ).toBe(true);
  });

  it("uses the context's injected `now` for the template year (no wall clock)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-tmpl-"));
    cleanup.push(dir);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".factory"), { recursive: true });
    await writeFile(
      join(dir, ".factory", "profile.yml"),
      "version: 1\nname: Acme\ntype: library\nproject:\n  license: MIT\n",
    );

    const ctx = buildContext(dir, { now: new Date("2019-07-04T00:00:00Z") });
    const control = {
      id: "repo.license.present",
      fix: { type: "template", template: "license" },
    } as Control;
    const changes = await templateGenerator(ctx, control);
    const license = changes.find(
      (c) => c.type === "file" && c.path === "LICENSE",
    );
    expect(license?.type === "file" && license.contents).toContain(
      "Copyright (c) 2019 Acme",
    );
  });

  it("returns a note instead of a placeholder when a required value is unset", async () => {
    const vars = templateVars(profile({ project: {} }), 2026);
    for (const name of ["codeowners", "security", "license"]) {
      const changes = await renderTemplate(name, vars, "c.x.y");
      expect(changes).toHaveLength(1);
      expect(changes[0]?.type).toBe("note");
    }
  });

  it("returns a note for a license it has no text for", async () => {
    const changes = await renderTemplate(
      "license",
      templateVars(profile({ project: { license: "GPL-3.0-only" } }), 2026),
      "repo.license.present",
    );
    expect(changes[0]).toMatchObject({ type: "note" });
  });

  it("renders the ISC text when the project chooses ISC", async () => {
    const changes = await renderTemplate(
      "license",
      templateVars(profile({ project: { license: "ISC" } }), 2026),
      "repo.license.present",
    );
    const license = changes[0];
    expect(license?.type === "file" && license.contents).toMatch(
      /^ISC License/,
    );
  });

  it("skips stack-specific files with a note when the stack is unknown", async () => {
    const changes = await renderTemplate(
      "ci-workflow",
      templateVars(profile({ stack: [] }), 2026),
      "ci.workflow.present",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: "note" });
  });

  it("renders go and rust CI workflows", async () => {
    for (const stack of ["go", "rust"]) {
      const changes = await renderTemplate(
        "ci-workflow",
        templateVars(profile({ stack: [stack] }), 2026),
        "ci.workflow.present",
      );
      const ci = changes[0];
      expect(ci?.type === "file" && ci.path).toBe(".github/workflows/ci.yml");
      expect(ci?.type === "file" && ci.contents).toContain(
        stack === "go" ? "go test" : "cargo test",
      );
    }
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
