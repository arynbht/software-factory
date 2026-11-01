// Bundle the CLI into a single file for the composite GitHub Action, and copy the
// catalog's controls/gates next to it so loadBundledCatalog resolves them at
// runtime (`../controls` relative to dist/index.js). Run via `pnpm action:build`.
import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const actionDir = resolve(root, "packages/action");

await rm(resolve(actionDir, "dist"), { recursive: true, force: true });
await rm(resolve(actionDir, "controls"), { recursive: true, force: true });
await rm(resolve(actionDir, "gates"), { recursive: true, force: true });

await build({
  entryPoints: [resolve(root, "packages/cli/dist/bin.js")],
  outfile: resolve(actionDir, "dist/index.js"),
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
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

console.log("Built packages/action/dist/index.js (+ controls, gates)");
