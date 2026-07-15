import { defineConfig } from "vitest/config";

import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";



const repoRoot = dirname(fileURLToPath(import.meta.url));

const siblingClumps = join(repoRoot, "..", "hdc-clumps");



export default defineConfig({

  resolve: {

    alias: [

      {

        find: /^hdc\/package\/(.+)$/,

        replacement: join(repoRoot, "apps/hdc-cli/lib/package/$1").replace(/\\/g, "/"),

      },

      {

        find: /^hdc\/cli\/(.+)$/,

        replacement: join(repoRoot, "apps/hdc-cli/$1").replace(/\\/g, "/"),

      },

      {

        find: /^hdc\/clump\/(.+)$/,

        replacement: join(siblingClumps, "$1").replace(/\\/g, "/"),

      },

    ],

  },

  test: {

    environment: "node",

    setupFiles: ["apps/hdc-cli/test/vitest-setup.mjs"],

    include: [

      "apps/hdc-cli/**/*.test.mjs",

      "apps/hdc-cli/lib/package/**/*.test.mjs",

      "apps/hdc-mcp-server/**/*.test.mjs",

      "apps/hdc-agent-server/**/*.test.mjs",

      "apps/hdc-augment-bridge/**/*.test.mjs",

      "apps/hdc-web-server/**/*.test.mjs",

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


