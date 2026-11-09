import type { AuditContext } from "./context.js";

/**
 * A language ecosystem the factory knows how to scaffold and check. `typescript`
 * is a facet of `node` (it implies node) used by TypeScript-only controls.
 */
export type Stack = "node" | "typescript" | "python" | "go" | "rust";

/** The stacks that select stack-specific template files and merge fragments. */
export const TEMPLATE_STACKS = ["node", "python", "go", "rust"] as const;
export type TemplateStack = (typeof TEMPLATE_STACKS)[number];

// Manifests are looked for at the root and up to two directories down, so a
// monorepo with `backend/` and `frontend/` packages is still detected.
const DEPTHS = ["", "*/", "*/*/"];
const at = (...names: string[]) =>
  DEPTHS.flatMap((d) => names.map((n) => `${d}${n}`));

const MANIFESTS: Record<Exclude<Stack, "typescript">, string[]> = {
  node: at("package.json"),
  python: at(
    "pyproject.toml",
    "requirements.txt",
    "requirements-*.txt",
    "setup.py",
    "setup.cfg",
    "Pipfile",
  ),
  go: at("go.mod"),
  rust: at("Cargo.toml"),
};

/** Profile `stack` entries (free text) mapped onto the stacks they imply. */
const DECLARED: Record<string, Stack[]> = {
  node: ["node"],
  nodejs: ["node"],
  javascript: ["node"],
  js: ["node"],
  typescript: ["node", "typescript"],
  ts: ["node", "typescript"],
  react: ["node"],
  next: ["node"],
  nextjs: ["node"],
  vue: ["node"],
  svelte: ["node"],
  express: ["node"],
  electron: ["node"],
  pnpm: ["node"],
  python: ["python"],
  django: ["python"],
  flask: ["python"],
  fastapi: ["python"],
  pytest: ["python"],
  go: ["go"],
  golang: ["go"],
  rust: ["rust"],
  cargo: ["rust"],
};

const ORDER: Stack[] = ["node", "typescript", "python", "go", "rust"];

/**
 * The repo's stacks: what its manifests show on disk, plus what the profile
 * declares (so an empty repo initialised with `--stack node` is scaffolded as
 * node). An empty list means "unknown" — callers skip stack-specific work rather
 * than guessing.
 */
export async function detectStacks(ctx: AuditContext): Promise<Stack[]> {
  const found = new Set<Stack>();

  for (const [stack, patterns] of Object.entries(MANIFESTS)) {
    if ((await ctx.glob(patterns)).length > 0) found.add(stack as Stack);
  }

  if (found.has("node")) {
    const tsconfig = await ctx.glob(at("tsconfig.json"));
    const pkg = (await ctx.readFile("package.json")) ?? "";
    if (tsconfig.length > 0 || /"typescript"\s*:/.test(pkg)) {
      found.add("typescript");
    }
  }

  const profile = await ctx.profile().catch(() => null);
  for (const stack of declaredStacks(profile?.stack ?? [])) found.add(stack);

  return ORDER.filter((s) => found.has(s));
}

/** The stacks a profile's free-text `stack` entries imply (`react` → node). */
export function declaredStacks(entries: readonly string[]): Stack[] {
  const found = new Set<Stack>();
  for (const entry of entries) {
    for (const stack of DECLARED[entry.toLowerCase()] ?? []) found.add(stack);
  }
  return ORDER.filter((s) => found.has(s));
}

/** The template buckets (node/python/go/rust) among the detected stacks. */
export function templateStacks(stacks: readonly string[]): TemplateStack[] {
  return TEMPLATE_STACKS.filter((s) => stacks.includes(s));
}
