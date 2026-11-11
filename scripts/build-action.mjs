// Bundle the CLI into a single file for the composite GitHub Action, and copy the
// catalog's controls/gates next to it so loadBundledCatalog resolves them at
// runtime (`../controls` relative to dist/index.js). Run via `pnpm action:build`.
import { createHash } from "node:crypto";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const actionDir = resolve(root, "packages/action");

/** Deterministic sha256 over the bundle's source inputs (platform-independent). */
async function sourceHash() {
  const roots = [
    resolve(root, "packages/catalog/src"),
    resolve(root, "packages/engine/src"),
    resolve(root, "packages/cli/src"),
    resolve(root, "packages/catalog/controls"),
    resolve(root, "packages/catalog/gates"),
    resolve(root, "packages/catalog/templates"),
    resolve(root, "packages/catalog/prompts"),
    resolve(root, "packages/catalog/skill"),
  ];
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!/\.(test|spec)\.ts$/.test(entry.name)) files.push(full);
    }
  }
  for (const r of roots) await walk(r);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(root, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update((await readFile(file, "utf8")).replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

await rm(resolve(actionDir, "dist"), { recursive: true, force: true });
await rm(resolve(actionDir, "controls"), { recursive: true, force: true });
await rm(resolve(actionDir, "gates"), { recursive: true, force: true });
await rm(resolve(actionDir, "templates"), { recursive: true, force: true });
await rm(resolve(actionDir, "prompts"), { recursive: true, force: true });
await rm(resolve(actionDir, "skill"), { recursive: true, force: true });

await build({
  entryPoints: [resolve(root, "packages/cli/dist/bin.js")],
  outfile: resolve(actionDir, "dist/index.js"),
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  // The AI SDK is only reached via `factory ai` / the claude generator, which the
  // Action (the `ci` entrypoint) never runs. Keep it out of the committed bundle so
  // it doesn't bloat the Action with ~300KB of code that never executes there.
  // Likewise Playwright and axe: only `factory task prove` loads them, lazily.
  external: ["@anthropic-ai/sdk", "playwright-core", "axe-core"],
  // Prefer each dependency's ESM build so esbuild can statically bundle it
  // (some UMD builds, e.g. jsonc-parser, use dynamic require()).
  mainFields: ["module", "main"],
  conditions: ["import", "module", "node"],
  // Shim CommonJS `require` for dependencies that use it inside the ESM bundle.
  banner: {
    js: "import{createRequire as _cr}from'module';const require=_cr(import.meta.url);",
  },
});

await cp(
  resolve(root, "packages/catalog/controls"),
  resolve(actionDir, "controls"),
  { recursive: true },
);
await cp(resolve(root, "packages/catalog/gates"), resolve(actionDir, "gates"), {
  recursive: true,
});
await cp(
  resolve(root, "packages/catalog/templates"),
  resolve(actionDir, "templates"),
  { recursive: true },
);
await cp(
  resolve(root, "packages/catalog/prompts"),
  resolve(actionDir, "prompts"),
  { recursive: true },
);
await cp(resolve(root, "packages/catalog/skill"), resolve(actionDir, "skill"), {
  recursive: true,
});

// A deterministic source hash CI can diff to catch a committed bundle that wasn't
// rebuilt after a source change (the bundle bytes themselves vary by platform).
await writeFile(
  resolve(actionDir, "dist/SOURCE_SHA256"),
  `${await sourceHash()}\n`,
  "utf8",
);

console.log(
  "Built packages/action/dist/index.js (+ controls, gates, SOURCE_SHA256)",
);
