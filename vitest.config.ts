import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Discover *.test.ts / *.spec.ts across all workspace packages.
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
