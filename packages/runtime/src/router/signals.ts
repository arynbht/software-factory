// What a task looks like in each sector, for the router (§5.1). Manifests only
// describe the skills that exist, and some sectors (data, api) have none, so
// the router carries its own signals and uses manifest triggers on top.
import type { Sector } from "@arynbht/factory-registry";

export interface SectorSignals {
  /** Matched as whole words in the card's title and description. */
  keywords: readonly string[];
  /** Matched against the card's `touches` and the repo files they cover. */
  paths: readonly string[];
}

export const SECTOR_SIGNALS: Record<Sector, SectorSignals> = {
  ui: {
    keywords: [
      "ui",
      "page",
      "screen",
      "component",
      "layout",
      "design",
      "redesign",
      "styling",
      "css",
      "theme",
      "button",
      "modal",
      "dialog",
      "navbar",
      "sidebar",
      "dark mode",
      "responsive",
      "frontend",
    ],
    paths: [
      "**/*.css",
      "**/*.scss",
      "**/*.tsx",
      "**/*.jsx",
      "**/*.vue",
      "**/*.svelte",
      "**/*.html",
      "**/components/**",
      "**/pages/**",
      "app/**/page.*",
    ],
  },
  motion: {
    keywords: [
      "animation",
      "animate",
      "motion",
      "transition",
      "easing",
      "keyframes",
    ],
    paths: [],
  },
  api: {
    keywords: [
      "api",
      "endpoint",
      "route handler",
      "rest",
      "graphql",
      "openapi",
      "webhook",
      "resolver",
      "controller",
      "n+1",
    ],
    paths: [
      "**/api/**",
      "**/routes/**",
      "**/handlers/**",
      "**/controllers/**",
      "**/resolvers/**",
      "**/*.graphql",
      "**/openapi.*",
      "**/swagger.*",
    ],
  },
  data: {
    keywords: [
      "database",
      "db",
      "query",
      "sql",
      "migration",
      "orm",
      "n+1",
      "table",
      "column",
      "seed",
      "prisma",
      "postgres",
    ],
    paths: [
      "**/migrations/**",
      "**/*.sql",
      "**/schema.prisma",
      "prisma/**",
      "**/models/**",
      "**/db/**",
      "**/repositories/**",
    ],
  },
  infra: {
    keywords: [
      "terraform",
      "infra",
      "infrastructure",
      "iac",
      "deploy",
      "deployment",
      "kubernetes",
      "k8s",
      "helm",
      "docker",
      "dockerfile",
      "pulumi",
    ],
    paths: [
      "**/*.tf",
      "**/*.tfvars",
      "**/Dockerfile",
      "infra/**",
      "deploy/**",
      "k8s/**",
      "helm/**",
    ],
  },
  security: {
    keywords: [
      "security",
      "auth",
      "authentication",
      "authorization",
      "login",
      "password",
      "secret",
      "csrf",
      "xss",
      "injection",
      "vulnerability",
      "cve",
      "permission",
      "oauth",
      "encryption",
    ],
    paths: ["**/auth/**", "**/security/**", "**/crypto/**"],
  },
  testing: {
    keywords: ["test", "e2e", "flaky", "coverage", "playwright"],
    paths: ["**/*.test.*", "**/*.spec.*", "e2e/**", "**/__tests__/**"],
  },
  a11y: {
    keywords: [
      "accessibility",
      "a11y",
      "wcag",
      "aria",
      "screen reader",
      "keyboard",
      "contrast",
    ],
    paths: [],
  },
  perf: {
    keywords: [
      "performance",
      "perf",
      "slow",
      "latency",
      "bundle size",
      "lighthouse",
      "memory leak",
      "caching",
    ],
    paths: [],
  },
  docs: {
    keywords: [
      "docs",
      "documentation",
      "readme",
      "changelog",
      "guide",
      "tutorial",
      "typo",
    ],
    paths: ["**/*.md", "**/*.mdx", "docs/**"],
  },
  product: {
    keywords: ["prd", "requirements", "roadmap", "discovery", "user story"],
    paths: [],
  },
  legal: {
    keywords: [
      "privacy",
      "gdpr",
      "ccpa",
      "hipaa",
      "dsar",
      "consent",
      "cookie banner",
      "data retention",
      "terms of service",
    ],
    paths: [],
  },
  workflow: {
    keywords: ["ci", "github actions", "workflow", "release"],
    paths: [".github/**"],
  },
  observability: {
    keywords: [
      "logging",
      "metrics",
      "tracing",
      "telemetry",
      "alert",
      "alerting",
      "dashboard",
      "slo",
      "monitoring",
    ],
    paths: [],
  },
};

/** Files that mean the repo has infrastructure as code (§5.1: infra joins). */
export const IAC_PATHS = [
  "**/*.tf",
  "**/*.tfvars",
  "**/Pulumi.yaml",
  "**/cdk.json",
  "**/*.bicep",
];

/** Paths that pause the agent whatever the task (§5.2 `stop_and_ask.touches`). */
export const SENSITIVE_PATHS = [
  "**/auth/**",
  "**/billing/**",
  "**/payments/**",
];

/** Words that shape the phases (§5.1 step 4). */
export const DESIGN_WORDS = ["redesign", "polish", "new page"];
export const FIX_WORDS = ["fix", "bug", "regression", "broken"];
/** Words that mean the schema changes, so data's proof is a migration dry-run. */
export const SCHEMA_WORDS = [
  "migration",
  "schema change",
  "new table",
  "new column",
  "add column",
  "drop column",
];
