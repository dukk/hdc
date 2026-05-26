import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tools/hdc/**/*.test.mjs",
      "packages/lib/**/*.test.mjs",
      "packages/infrastructure/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["tools/hdc/**/*.mjs"],
      exclude: [
        "tools/hdc/**/*.test.mjs",
        "tools/hdc/test/**",
        "tools/hdc/cli.mjs",
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
