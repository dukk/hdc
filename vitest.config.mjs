import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["apps/hdc-cli/test/vitest-setup.mjs"],
    include: [
      "apps/hdc-cli/**/*.test.mjs",
      "apps/hdc-mcp/**/*.test.mjs",
      "clumps/lib/**/*.test.mjs",
      "clumps/clients/**/*.test.mjs",
      "clumps/infrastructure/**/*.test.mjs",
      "clumps/services/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["apps/hdc-cli/**/*.mjs"],
      exclude: [
        "apps/hdc-cli/**/*.test.mjs",
        "apps/hdc-cli/test/**",
        "apps/hdc-cli/scripts/**",
        "apps/hdc-cli/cli.mjs",
        "node_modules/**",
      ],
      thresholds: {
        lines: 88,
        functions: 88,
        branches: 82,
        statements: 88,
      },
    },
  },
});
