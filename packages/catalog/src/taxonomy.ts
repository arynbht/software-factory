// Taxonomy: the 14 lanes, 9 phases, and 4 severities every control is classified
// by. This is the single source of truth the schema derives its enums from.
//
// Control ids are `<laneCode>.<topic>.<name>` (e.g. `sec.secret-scanning.pre-commit`).
// Each lane has a stable short `code` used as the id prefix; the schema checks that
// a control's id prefix matches its declared lane (see schema.ts).

export interface LaneDef {
  /** Full lane key, used as the `lane` field value. */
  key: string;
  /** Stable short code used as the control id prefix. Never change once shipped. */
  code: string;
  title: string;
  description: string;
}

export const LANES = [
  {
    key: "hygiene",
    code: "repo",
    title: "Repo hygiene & governance",
    description:
      "Baseline repository files, branch protection, and governance that every repo needs.",
  },
  {
    key: "development",
    code: "dev",
    title: "Development",
    description:
      "Linting, formatting, type safety, local hooks, and config hygiene for day-to-day work.",
  },
  {
    key: "testing",
    code: "test",
    title: "Testing",
    description:
      "Unit, integration, end-to-end, and specialised testing with coverage expectations.",
  },
  {
    key: "security",
    code: "sec",
    title: "Security & supply chain",
    description:
      "Secret scanning, SAST, dependency and container scanning, SBOM, and threat modelling.",
  },
  {
    key: "accessibility",
    code: "a11y",
    title: "Accessibility",
    description:
      "WCAG conformance, automated and manual accessibility checks on key flows.",
  },
  {
    key: "legal",
    code: "legal",
    title: "Legal & compliance",
    description:
      "Licensing, privacy, data protection, and regulatory obligations.",
  },
  {
    key: "cloud",
    code: "cloud",
    title: "Cloud & infrastructure",
    description:
      "Infrastructure as code, environments, IAM, backups, and cost controls.",
  },
  {
    key: "cicd",
    code: "ci",
    title: "CI/CD & release",
    description:
      "Continuous integration, caching, action pinning, versioning, and release automation.",
  },
  {
    key: "observability",
    code: "ops",
    title: "Observability & operations",
    description:
      "Logs, metrics, traces, SLOs, alerts, runbooks, and on-call practices.",
  },
  {
    key: "data",
    code: "data",
    title: "Data",
    description:
      "Schema migrations, PII classification, encryption, and retention.",
  },
  {
    key: "performance",
    code: "perf",
    title: "Performance",
    description: "Performance budgets, load testing, and caching strategy.",
  },
  {
    key: "ux",
    code: "ux",
    title: "UX & UI",
    description:
      "Design systems, key-flow states, responsiveness, and user feedback.",
  },
  {
    key: "documentation",
    code: "docs",
    title: "Documentation & DX",
    description:
      "Diátaxis docs, ADRs, architecture diagrams, runbooks, and changelogs.",
  },
  {
    key: "product",
    code: "product",
    title: "Product & launch",
    description:
      "Discovery briefs, requirements, risk registers, and launch readiness.",
  },
] as const satisfies readonly LaneDef[];

export type LaneKey = (typeof LANES)[number]["key"];
export type LaneCode = (typeof LANES)[number]["code"];

export const LANE_KEYS = LANES.map((l) => l.key) as [LaneKey, ...LaneKey[]];

export const LANE_BY_KEY: Record<LaneKey, LaneDef> = Object.fromEntries(
  LANES.map((l) => [l.key, l]),
) as Record<LaneKey, LaneDef>;

export interface PhaseDef {
  key: string;
  /** 1-based order; a lower phase is "earlier" in a project's lifecycle. */
  order: number;
  title: string;
  description: string;
}

export const PHASES = [
  {
    key: "discovery",
    order: 1,
    title: "Discovery",
    description: "Problem, users, and whether the thing is worth building.",
  },
  {
    key: "requirements",
    order: 2,
    title: "Requirements",
    description:
      "User stories, acceptance criteria, and non-functional targets.",
  },
  {
    key: "architecture",
    order: 3,
    title: "Architecture",
    description: "System shape, key decisions (ADRs), and C4 diagrams.",
  },
  {
    key: "design",
    order: 4,
    title: "Design",
    description: "UX flows, design tokens, and accessibility targets.",
  },
  {
    key: "scaffold",
    order: 5,
    title: "Scaffold",
    description: "Baseline repo files, CI, and tooling in place.",
  },
  {
    key: "build",
    order: 6,
    title: "Build",
    description: "Feature work with tests and review gates.",
  },
  {
    key: "harden",
    order: 7,
    title: "Harden",
    description: "Security, performance, and operability work before launch.",
  },
  {
    key: "launch",
    order: 8,
    title: "Launch",
    description: "Go/no-go readiness, legal sign-off, and release.",
  },
  {
    key: "operate",
    order: 9,
    title: "Operate",
    description: "Running in production: observability, incidents, and upkeep.",
  },
] as const satisfies readonly PhaseDef[];

export type PhaseKey = (typeof PHASES)[number]["key"];

export const PHASE_KEYS = PHASES.map((p) => p.key) as [PhaseKey, ...PhaseKey[]];

export const PHASE_BY_KEY: Record<PhaseKey, PhaseDef> = Object.fromEntries(
  PHASES.map((p) => [p.key, p]),
) as Record<PhaseKey, PhaseDef>;

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Rough implementation effort tag (used for prioritisation; wired fully in M6). */
export const EFFORTS = ["small", "medium", "large"] as const;
export type Effort = (typeof EFFORTS)[number];
