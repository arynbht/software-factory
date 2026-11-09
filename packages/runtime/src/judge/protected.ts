import picomatch from "picomatch";

/** One file in the diff between the base commit and the change under review. */
export interface DiffEntry {
  /** A added, M modified, D deleted, R renamed (path is the new name). */
  status: "A" | "M" | "D" | "R";
  path: string;
  /** For renames: the path at base. */
  oldPath?: string | undefined;
}

export type ProtectedReason =
  | "factory-state"
  | "lint-config"
  | "ci-config"
  | "scripts"
  | "existing-test"
  | "suppression";

export interface ProtectedFinding {
  reason: ProtectedReason;
  path: string;
  detail: string;
}

/** The judge's own record of what counts as a protected path. */
export const PROTECTED = {
  factoryState: [".factory/**"],
  lintConfig: [
    "**/eslint.config.*",
    "**/.eslintrc*",
    "**/.prettierrc*",
    "**/prettier.config.*",
    "**/biome.json",
    "**/biome.jsonc",
    "**/ruff.toml",
    "**/.ruff.toml",
    "**/.flake8",
    "**/.pylintrc",
    "**/mypy.ini",
    "**/.golangci.*",
    "**/clippy.toml",
    "**/.clippy.toml",
    "**/rustfmt.toml",
    "**/tsconfig*.json",
    "**/.editorconfig",
  ],
  ciConfig: [
    ".github/workflows/**",
    ".github/actions/**",
    "lefthook.yml",
    "lefthook.yaml",
    ".lefthook.yml",
    ".pre-commit-config.yaml",
    ".husky/**",
    "commitlint.config.*",
  ],
  tests: [
    "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}",
    "**/test_*.py",
    "**/*_test.py",
    "**/conftest.py",
    "**/*_test.go",
    "**/tests/**",
    "**/test/**",
    "**/__tests__/**",
    "**/e2e/**",
  ],
} as const;

/** Lines that switch a check off for the code next to them. */
const SUPPRESSION =
  /(eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|#\s*noqa|#\s*type:\s*ignore|\/\/\s*nolint|#\s*pragma:\s*no cover|#!?\[allow\(|biome-ignore)/;

// Wrapped so a matcher passed to `.some()` never receives the array index as
// picomatch's `returnObject` argument.
const matcher = (globs: readonly string[]): ((path: string) => boolean) => {
  const isMatch = picomatch([...globs], { dot: true });
  return (path) => isMatch(path);
};
const isFactoryState = matcher(PROTECTED.factoryState);
const isLintConfig = matcher(PROTECTED.lintConfig);
const isCiConfig = matcher(PROTECTED.ciConfig);
export const isTestFile = matcher(PROTECTED.tests);

/**
 * Changes the agent must not make on its own: anything here marks the result
 * `needs-human`. Added test files are fine (they're how a change proves itself);
 * changing or deleting a test that existed at base is not.
 *
 * `addedLines` maps a path to the lines the change adds (from a zero-context
 * diff); `scriptsChanged` says whether package.json `scripts` differ from base.
 */
export function findProtected(
  diff: readonly DiffEntry[],
  addedLines: ReadonlyMap<string, readonly string[]>,
  scriptsChanged: boolean,
): ProtectedFinding[] {
  const findings: ProtectedFinding[] = [];
  for (const entry of diff) {
    const paths = [entry.path, entry.oldPath].filter(
      (p): p is string => p !== undefined,
    );
    if (paths.some(isFactoryState)) {
      findings.push({
        reason: "factory-state",
        path: entry.path,
        detail:
          "changes factory state (.factory/**): waivers, evidence and profile are human decisions",
      });
    } else if (paths.some(isLintConfig)) {
      findings.push({
        reason: "lint-config",
        path: entry.path,
        detail: "changes lint, format or type-check configuration",
      });
    } else if (paths.some(isCiConfig)) {
      findings.push({
        reason: "ci-config",
        path: entry.path,
        detail: "changes CI or git hook configuration",
      });
    } else if (entry.status !== "A" && paths.some(isTestFile)) {
      findings.push({
        reason: "existing-test",
        path: entry.path,
        detail:
          entry.status === "D"
            ? "deletes a test that existed at base"
            : "modifies a test that existed at base",
      });
    }
  }

  if (scriptsChanged) {
    findings.push({
      reason: "scripts",
      path: "package.json",
      detail: "changes package.json scripts (the commands the checks run)",
    });
  }

  for (const [path, lines] of addedLines) {
    const hit = lines.find((line) => SUPPRESSION.test(line));
    if (hit) {
      findings.push({
        reason: "suppression",
        path,
        detail: `adds a check suppression: ${hit.trim().slice(0, 120)}`,
      });
    }
  }
  return findings;
}

/** `.factory/**`, lint or CI config: always judged as it was at base. */
export function isProtectedConfig(path: string): boolean {
  return isFactoryState(path) || isLintConfig(path) || isCiConfig(path);
}
