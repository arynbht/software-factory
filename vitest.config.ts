import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Discover *.test.ts / *.spec.ts across all workspace packages.
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Many tests drive real git repos and child processes. Under the whole
    // suite with coverage on a loaded machine (a factory task's worktree on
    // Windows), the 5s default timed them out; nothing about them was wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      // On for every run, so `pnpm test` always writes coverage-summary.json
      // (the judge's coverage floor reads it after its test run).
      enabled: true,
      provider: "v8",
      reporter: ["json-summary", "text-summary"],
      include: ["packages/*/src/**/*.ts", "apps/desktop/src/**/*.{ts,tsx}"],
      exclude: ["**/*.{test,spec}.ts", "**/*.d.ts", "**/dist/**"],
      // The measured baseline (2026-11-09), rounded down. Raise these as coverage
      // grows; never lower them. A partial run (`vitest run <path>`) covers less
      // than the whole include set, so pass `--coverage.enabled=false` for one.
      thresholds: {
        statements: 52,
        branches: 77,
        functions: 75,
        lines: 52,
      },
    },
  },
});
