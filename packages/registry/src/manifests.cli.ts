// Maintainer tool for the bundled manifests (packages/registry/manifests/):
//   pnpm registry:pin       fetch each `hash: "sha256:pending"` manifest at its
//                           pin and record the real content hash
//   pnpm registry:validate  schema + cross-manifest checks (CI)
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

import { ensureCached } from "./cache.js";
import { bundledManifestsDir, loadManifests } from "./repo.js";
import { scanSkill } from "./scan.js";

const PENDING = "sha256:pending";

async function pin(dir: string): Promise<number> {
  let failures = 0;
  for (const file of (await readdir(dir))
    .filter((f) => f.endsWith(".yml"))
    .sort()) {
    const path = join(dir, file);
    const text = await readFile(path, "utf8");
    const raw = parse(text) as {
      name: string;
      source: string;
      pin: string;
      mirror?: string;
      hash: string;
      scan_allow?: string[];
    };
    if (raw.hash !== PENDING) continue;
    try {
      const { dir: skillDir, hash } = await ensureCached(raw, undefined);
      const findings = await scanSkill(skillDir, raw.scan_allow ?? []);
      await writeFile(
        path,
        text.replace(/hash:\s*"?sha256:pending"?/, `hash: "${hash}"`),
        "utf8",
      );
      console.log(`${raw.name}: ${hash}`);
      for (const f of findings) {
        console.log(`  scan ${f.rule} ${f.file}:${f.line}  ${f.text}`);
      }
    } catch (err) {
      failures++;
      console.error(`${raw.name}: ${(err as Error).message}`);
    }
  }
  return failures;
}

async function validate(dir: string): Promise<number> {
  // Validate the bundled set alone: a repo path with no local manifests.
  const { manifests, errors } = await loadManifests(join(dir, "__none__"), dir);
  for (const e of errors) console.error(`${e.name}: ${e.message}`);
  if (errors.length === 0)
    console.log(`✓ ${manifests.size} skill manifest(s) valid`);
  return errors.length;
}

const mode = process.argv[2];
const dir = bundledManifestsDir();
const failures =
  mode === "pin"
    ? await pin(dir)
    : mode === "validate"
      ? await validate(dir)
      : -1;
if (failures === -1) console.error("usage: manifests.cli.ts pin|validate");
process.exitCode = failures === 0 ? 0 : 1;
