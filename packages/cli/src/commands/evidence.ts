import { resolve } from "node:path";

import {
  addEvidence,
  type EvidenceEntry,
  EvidenceError,
  hashFile,
} from "@arynbht/factory-engine";

export interface EvidenceFlags {
  url?: string;
  file?: string;
  note?: string;
  reviewer?: string;
  validFor?: string;
}

/** `factory evidence add <control> --url|--file [--note --reviewer --valid-for]`. */
export async function runEvidenceAdd(
  control: string,
  flags: EvidenceFlags,
  path: string,
  date: string,
): Promise<number> {
  if (!flags.url && !flags.file) {
    console.error("factory evidence add: provide --url or --file");
    return 1;
  }

  const entry: EvidenceEntry = { control, date };
  if (flags.reviewer) entry.reviewer = flags.reviewer;
  if (flags.note) entry.note = flags.note;
  if (flags.validFor) entry["valid-for"] = flags.validFor;
  if (flags.url) entry.url = flags.url;
  if (flags.file) {
    try {
      entry.sha256 = await hashFile(resolve(flags.file));
    } catch {
      console.error(`factory evidence add: cannot read file: ${flags.file}`);
      return 1;
    }
  }

  try {
    await addEvidence(resolve(path), entry);
  } catch (err) {
    const message = err instanceof EvidenceError ? err.message : String(err);
    console.error(`factory evidence add: ${message}`);
    return 1;
  }
  process.stdout.write(`Recorded evidence for ${control}\n`);
  return 0;
}
