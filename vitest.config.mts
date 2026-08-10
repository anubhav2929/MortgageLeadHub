import { defineConfig } from "vitest/config";

// Tests target src/core — the pure business logic. That boundary is
// deliberate and enforced by tests/architecture.test.ts: core/ has no I/O,
// no database, no vendor SDKs and no framework imports, so its tests need no
// mocks, no fixtures server and no network. They run in milliseconds and
// cannot flake.
//
// Coverage thresholds are set on core/ only. Applying a single global
// threshold across UI components would push the team toward writing shallow
// render tests to hit a number, which is the failure mode that makes coverage
// gates counterproductive.
export default defineConfig({
  // Resolves the "@/*" alias straight from tsconfig.json, so tests import
  // exactly the same specifiers as application code.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/core/**/*.ts"],
      exclude: ["src/core/integrationRegistry.ts"], // static config data, no branches
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
