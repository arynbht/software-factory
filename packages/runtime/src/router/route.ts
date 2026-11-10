// The router (§5): a confirmed card and the repo in, an assembly out — which
// sectors, phases, skills, checks, proof and budget the task runs with. It is
// deterministic (no model call), and every decision carries its reason, so the
// human approving the assembly sees why each part is there.
import {
  type Manifest,
  type Sector,
  SECTORS,
  SKILL_PHASES,
  type SkillPhase,
} from "@arynbht/factory-registry";
import picomatch from "picomatch";
import { z } from "zod";

import { type Card, RISKS } from "../task/card.js";
import {
  DESIGN_WORDS,
  FIX_WORDS,
  IAC_PATHS,
  SCHEMA_WORDS,
  SECTOR_SIGNALS,
  SENSITIVE_PATHS,
} from "./signals.js";

export const PROOF_TYPES = [
  "ui-screenshots",
  "api-contract",
  "migration-dry-run",
  "infra-plan",
  "test-run",
  "docs-render",
] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

export const STOP_TRIGGERS = ["new_dependency", "schema_change"] as const;

/** Task-scope skills per assembly; the spine doesn't count (§5.3). */
export const MAX_TASK_SKILLS = 4;
/** A sector is in at this score: one path hit, or one title keyword. */
export const SECTOR_THRESHOLD = 2;
/** Critique skills in order of preference: one per task (§5.3). */
const CRITIQUE = ["impeccable", "taste-skill"];
/** Loaded only when no critique skill is in the assembly. */
const CRITIQUE_FALLBACK = "frontend-design";
const STEPS: Record<(typeof RISKS)[number], number> = {
  low: 8,
  medium: 12,
  high: 16,
};
const CONTEXT_TOKENS = 60_000;

export const AssemblySchema = z.strictObject({
  task: z.string().min(1),
  sectors: z.array(z.enum(SECTORS)),
  phases: z.array(z.enum(SKILL_PHASES)).min(1),
  /** Loaded for this task, in this order; at most four, conflicts resolved. */
  skills: z.array(z.string().min(1)).max(MAX_TASK_SKILLS),
  /** Always-scope skills that bear on this task (installed already). */
  spine: z.array(z.string().min(1)).default([]),
  budget: z.strictObject({
    skill_tokens: z.number().int().nonnegative(),
    context_tokens: z.number().int().positive(),
    steps: z.number().int().positive(),
  }),
  /** Catalog control ids the judge's tier 1 runs. */
  checks: z.array(z.string().min(1)).min(1),
  proof: z.enum(PROOF_TYPES),
  review: z.strictObject({
    rubric: z.literal("default"),
    design_pass: z.boolean(),
    security: z.boolean(),
  }),
  stop_and_ask: z.array(
    z.union([
      z.enum(STOP_TRIGGERS),
      z.strictObject({ touches: z.array(z.string().min(1)).min(1) }),
    ]),
  ),
  /** Sectors in the task that no vendored skill covers (§5.3). */
  gaps: z.array(z.string()).default([]),
});
export type Assembly = z.infer<typeof AssemblySchema>;

export interface RouteInput {
  card: Card;
  manifests: ReadonlyMap<string, Manifest>;
  /** Skills that can be loaded: locked, synced and not blocked. */
  available: ReadonlySet<string>;
  /** The profile's flags. */
  flags?: Readonly<Record<string, boolean | undefined>> | undefined;
  /** The repo's files (`git ls-files`), to expand `touches` and spot IaC. */
  files?: readonly string[] | undefined;
  /** The change checks the judge can run (catalog control ids). */
  checks: readonly string[];
}

export interface SectorScore {
  sector: Sector;
  score: number;
  reasons: string[];
}

export interface Routing {
  assembly: Assembly;
  /** Every sector that scored, highest first. */
  scores: SectorScore[];
  /** Sectors that scored under the threshold: the human decides (§5.1). */
  borderline: Sector[];
  /** Decisions made along the way: conflicts, unavailable skills, the cap. */
  notes: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-word (or plural) match, case-insensitive. */
export function hasWord(text: string, word: string): boolean {
  return new RegExp(
    `(?<![a-z0-9])${escape(word.toLowerCase())}s?(?![a-z0-9])`,
  ).test(text.toLowerCase());
}

/** The first glob that matches a `touches` pattern or a file it covers. */
function pathHit(
  globs: readonly string[],
  touched: readonly string[],
): string | undefined {
  for (const glob of globs) {
    const isMatch = picomatch(glob, { dot: true });
    const hit = touched.find((t) => isMatch(t));
    if (hit) return hit === glob ? glob : `${glob} (${hit})`;
  }
  return undefined;
}

export function route(input: RouteInput): Routing {
  const { card, manifests, available } = input;
  const flags = input.flags ?? {};
  const files = input.files ?? [];
  const title = card.title.toLowerCase();
  const text = `${card.title}\n${card.description}`.toLowerCase();
  let covered: string[] = [];
  if (card.touches.length > 0) {
    // Wrapped: a bare matcher would take filter's index as `returnObject`.
    const inTouches = picomatch([...card.touches], { dot: true });
    covered = files.filter((f) => inTouches(f));
  }
  const touched = [...card.touches, ...covered];
  const notes: string[] = [];

  // 1–3. Score each sector: paths, keywords, manifest triggers, profile.
  const scores = new Map<Sector, SectorScore>();
  const add = (sector: Sector, points: number, reason: string) => {
    const s = scores.get(sector) ?? { sector, score: 0, reasons: [] };
    s.score += points;
    s.reasons.push(reason);
    scores.set(sector, s);
  };
  for (const sector of SECTORS) {
    const signals = SECTOR_SIGNALS[sector];
    const path = pathHit(signals.paths, touched);
    if (path) add(sector, 2, `touches ${path}`);
    for (const word of signals.keywords) {
      if (hasWord(title, word)) add(sector, 2, `"${word}" in the title`);
      else if (hasWord(text, word))
        add(sector, 1, `"${word}" in the description`);
    }
  }
  for (const m of manifests.values()) {
    if (m.scope !== "task") continue;
    const hit =
      pathHit(m.triggers.paths, touched) ??
      m.triggers.keywords.find((k) => hasWord(text, k));
    if (!hit) continue;
    for (const sector of m.sectors) {
      if (!scores.get(sector)?.reasons.some((r) => r.startsWith("skill ")))
        add(sector, 1, `skill ${m.name} triggers on ${hit}`);
    }
  }
  const isIac = picomatch(IAC_PATHS, { dot: true });
  const iac = files.some((f) => isIac(f));
  if (iac) add("infra", 1, "the repo has infrastructure as code");

  const inSectors = new Set<Sector>(
    [...scores.values()]
      .filter((s) => s.score >= SECTOR_THRESHOLD)
      .map((s) => s.sector),
  );
  // Profile flags bring in the sector they qualify, alongside it.
  const join = (sector: Sector, reason: string) => {
    if (inSectors.has(sector)) return;
    inSectors.add(sector);
    const s = scores.get(sector) ?? { sector, score: 0, reasons: [] };
    s.reasons.push(reason);
    scores.set(sector, s);
  };
  if (inSectors.has("ui") && flags["public-facing"])
    join("a11y", "the profile is public-facing and the task has UI");
  if (inSectors.has("data") && flags["handles-pii"])
    join("legal", "the profile handles PII and the task touches data");

  const ranked = [...scores.values()].sort(
    (a, b) =>
      Number(inSectors.has(b.sector)) - Number(inSectors.has(a.sector)) ||
      b.score - a.score ||
      SECTORS.indexOf(a.sector) - SECTORS.indexOf(b.sector),
  );
  const sectors = ranked
    .filter((s) => inSectors.has(s.sector))
    .map((s) => s.sector);
  const borderline = ranked
    .filter((s) => !inSectors.has(s.sector) && s.score > 0)
    .map((s) => s.sector);

  // 4. Phases from the task's type and wording.
  const phases = new Set<SkillPhase>(
    card.type === "feature" || card.type === "spike"
      ? ["brief", "build", "prove", "review"]
      : ["build", "prove", "review"],
  );
  if (DESIGN_WORDS.some((w) => hasWord(text, w))) {
    phases.add("brief");
    phases.add("polish");
  }
  if (card.type === "fix" || FIX_WORDS.some((w) => hasWord(text, w))) {
    phases.delete("brief");
    phases.add("prove");
  }

  // Skills: task-scope manifests in the task's sectors and phases that
  // trigger (or that the card names), best first; conflicts, requirements and
  // the cap of four resolved in that order.
  const named = (name: string) => hasWord(text, name);
  const candidates = [...manifests.values()]
    .filter(
      (m) =>
        m.scope === "task" &&
        m.sectors.some((s) => inSectors.has(s)) &&
        m.phases.some((p) => phases.has(p)),
    )
    .map((m) => {
      const hits =
        (pathHit(m.triggers.paths, touched) ? 1 : 0) +
        m.triggers.keywords.filter((k) => hasWord(text, k)).length;
      // A profile flag ranks a skill that matched; it can't match one alone
      // (every UI task in a public-facing repo isn't a new page).
      const qualified =
        hits > 0 ? m.triggers.flags.filter((f) => flags[f]) : [];
      return { m, named: named(m.name), hits: hits + qualified.length };
    })
    .filter((c) => c.named || c.hits > 0)
    .sort(
      (a, b) =>
        Number(b.named) - Number(a.named) ||
        b.hits - a.hits ||
        rank(a.m.name) - rank(b.m.name) ||
        a.m.name.localeCompare(b.m.name),
    );

  const skills: string[] = [];
  const conflicting = (name: string) =>
    skills.find(
      (s) =>
        manifests.get(s)?.conflicts.includes(name) ||
        manifests.get(name)?.conflicts.includes(s),
    );
  if (available.size === 0 && candidates.length > 0) {
    notes.push(
      `no skills are synced in this repo (\`factory skills init\`, then \`factory skills sync\`); matched: ${candidates.map((c) => c.m.name).join(", ")}`,
    );
  }
  for (const { m } of available.size > 0 ? candidates : []) {
    if (skills.includes(m.name)) continue;
    const group = withRequires(m.name, manifests).filter(
      (n) => !skills.includes(n),
    );
    const missing = group.find((n) => !available.has(n));
    if (missing) {
      notes.push(
        missing === m.name
          ? `${m.name} matched but isn't available (not locked, not synced, or blocked at sync)`
          : `${m.name} left out: it requires ${missing}, which isn't available`,
      );
      continue;
    }
    const clash = group
      .map((n) => [n, conflicting(n)] as const)
      .find(([, c]) => c);
    if (clash) {
      notes.push(`${m.name} left out: ${clash[0]} conflicts with ${clash[1]}`);
      continue;
    }
    if (skills.length + group.length > MAX_TASK_SKILLS) {
      notes.push(
        `${m.name} left out: the assembly is at ${MAX_TASK_SKILLS} skills`,
      );
      continue;
    }
    skills.push(...group);
  }
  if (
    skills.includes(CRITIQUE_FALLBACK) &&
    skills.some((s) => CRITIQUE.includes(s))
  ) {
    skills.splice(skills.indexOf(CRITIQUE_FALLBACK), 1);
    notes.push(
      `${CRITIQUE_FALLBACK} left out: a critique skill is already in the assembly`,
    );
  }

  const spine = [...manifests.values()]
    .filter(
      (m) =>
        m.scope === "always" &&
        available.has(m.name) &&
        (m.sectors.some((s) => inSectors.has(s)) || named(m.name)),
    )
    .map((m) => m.name)
    .sort();

  const gaps = sectors
    .filter(
      (sector) =>
        ![...skills, ...spine].some((n) =>
          manifests.get(n)?.sectors.includes(sector),
        ),
    )
    .map(
      (sector) =>
        `${sector}: no vendored skill covers it; the agent works from the spine`,
    );

  return {
    assembly: {
      task: card.id,
      sectors,
      phases: SKILL_PHASES.filter((p) => phases.has(p)),
      skills,
      spine,
      budget: {
        skill_tokens: skills.reduce(
          (sum, n) => sum + (manifests.get(n)?.tokens ?? 0),
          0,
        ),
        context_tokens: CONTEXT_TOKENS,
        steps: STEPS[card.risk],
      },
      checks: [...input.checks],
      proof: proofFor(inSectors, text, touched),
      review: {
        rubric: "default",
        design_pass:
          inSectors.has("ui") && (phases.has("polish") || card.risk === "high"),
        security: inSectors.has("security"),
      },
      stop_and_ask: [...STOP_TRIGGERS, { touches: [...SENSITIVE_PATHS] }],
      gaps,
    },
    scores: ranked,
    borderline,
    notes,
  };
}

function rank(name: string): number {
  const i = CRITIQUE.indexOf(name);
  return i === -1 ? CRITIQUE.length : i;
}

/** A skill and everything it requires, requirements first. */
function withRequires(
  name: string,
  manifests: ReadonlyMap<string, Manifest>,
  seen = new Set<string>(),
): string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const requires = manifests.get(name)?.requires ?? [];
  return [...requires.flatMap((r) => withRequires(r, manifests, seen)), name];
}

/** The proof a tool produces for this task (§3.5), most specific sector first. */
function proofFor(
  sectors: ReadonlySet<Sector>,
  text: string,
  touched: readonly string[],
): ProofType {
  if (sectors.has("ui")) return "ui-screenshots";
  if (sectors.has("infra")) return "infra-plan";
  if (
    sectors.has("data") &&
    (SCHEMA_WORDS.some((w) => hasWord(text, w)) ||
      pathHit(["**/migrations/**", "**/*.sql", "**/schema.prisma"], touched))
  )
    return "migration-dry-run";
  if (
    sectors.has("api") &&
    (["endpoint", "openapi", "graphql", "contract"].some((w) =>
      hasWord(text, w),
    ) ||
      pathHit(["**/*.graphql", "**/openapi.*", "**/swagger.*"], touched))
  )
    return "api-contract";
  if (sectors.size > 0 && [...sectors].every((s) => s === "docs"))
    return "docs-render";
  return "test-run";
}

/**
 * Problems with an assembly a human may have edited: the schema, then the
 * rules routing guarantees — skills exist, are task-scope and available,
 * don't conflict, bring what they require, one critique skill; spine skills
 * are always-scope; every check is one the judge can run.
 */
export function validateAssembly(
  input: unknown,
  context: {
    task: string;
    manifests: ReadonlyMap<string, Manifest>;
    available: ReadonlySet<string>;
    checks: readonly string[];
  },
): { assembly?: Assembly; problems: string[] } {
  const parsed = AssemblySchema.safeParse(input);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(assembly)"}: ${i.message}`,
      ),
    };
  }
  const a = parsed.data;
  const { manifests, available } = context;
  const problems: string[] = [];
  if (a.task !== context.task)
    problems.push(`task is ${a.task}, not ${context.task}`);
  // A conflict counts from either side, reported once per pair.
  const clashes = new Set<string>();
  for (const name of a.skills) {
    for (const other of a.skills) {
      if (
        name !== other &&
        manifests.get(name)?.conflicts.includes(other) === true
      )
        clashes.add([name, other].sort().join(" conflicts with "));
    }
  }
  for (const name of a.skills) {
    const m = manifests.get(name);
    if (!m) problems.push(`skills: no manifest for ${name}`);
    else if (m.scope !== "task")
      problems.push(`skills: ${name} is a spine skill; list it under spine`);
    else if (!available.has(name))
      problems.push(`skills: ${name} isn't available (lock and sync it first)`);
    for (const r of m?.requires ?? []) {
      if (!a.skills.includes(r)) problems.push(`skills: ${name} requires ${r}`);
    }
  }
  for (const clash of [...clashes].sort()) problems.push(`skills: ${clash}`);
  if (a.skills.filter((s) => CRITIQUE.includes(s)).length > 1)
    problems.push("skills: one critique skill per task");
  if (new Set(a.skills).size !== a.skills.length)
    problems.push("skills: listed twice");
  for (const name of a.spine) {
    const m = manifests.get(name);
    if (!m || m.scope !== "always")
      problems.push(`spine: ${name} isn't an always-scope skill`);
    else if (!available.has(name))
      problems.push(`spine: ${name} isn't available (lock and sync it first)`);
  }
  const tokens = a.skills.reduce(
    (sum, n) => sum + (manifests.get(n)?.tokens ?? 0),
    0,
  );
  if (a.budget.skill_tokens !== tokens)
    problems.push(
      `budget.skill_tokens is ${a.budget.skill_tokens}; the skills add up to ${tokens}`,
    );
  for (const id of a.checks) {
    if (!context.checks.includes(id))
      problems.push(`checks: ${id} isn't a check the judge can run`);
  }
  return problems.length > 0 ? { problems } : { assembly: a, problems };
}
