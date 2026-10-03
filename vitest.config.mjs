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

    // Leave cores free for interactive workloads (agents run this after every CLI change).
    maxWorkers: 4,

    setupFiles: ["apps/hdc-cli/test/vitest-setup.mjs"],

    include: [
      "apps/hdc-cli/**/*.test.mjs",
      "apps/hdc-cli/lib/package/**/*.test.mjs",
      "apps/hdc-mcp-server/**/*.test.mjs",
      "apps/hdc-agent-server/**/*.test.mjs",
      "apps/hdc-augment-bridge/**/*.test.mjs",
      "apps/hdc-web-server/**/*.test.mjs",
      "../hdc-clumps/**/*.test.mjs",
      "hdc-clumps/**/*.test.mjs",
    ],

    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "../hdc-clumps/node_modules/**",
      "hdc-clumps/node_modules/**",
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

        // Integration-heavy modules without dedicated unit coverage (exercise via package runs).
        "apps/hdc-cli/lib/notify.mjs",
        "apps/hdc-cli/lib/notify-discord.mjs",
        "apps/hdc-cli/lib/notify-slack-app.mjs",
        "apps/hdc-cli/lib/notify-slack-incoming-webhook.mjs",
        "apps/hdc-cli/lib/vault-key-uris.mjs",
        "apps/hdc-cli/lib/package/preload.mjs",
        "apps/hdc-cli/lib/package/bind-tsig-for-acme.mjs",
        "apps/hdc-cli/lib/package/qemu-ubuntu-console-repair.mjs",
        "apps/hdc-cli/lib/package/guest-linux-baseline.mjs",
        "apps/hdc-cli/lib/package/crowdsec-agent-ensure.mjs",
        "apps/hdc-cli/lib/package/wazuh-agent-ensure.mjs",
        "apps/hdc-cli/lib/package/proxmox-guest-startup-maintain-sync.mjs",
        "apps/hdc-cli/lib/package/clients/**",
        "apps/hdc-cli/lib/package/service-health/**",

      ],

      // Floor after clumps extraction + untested package surface growth; raise as tests catch up.
      thresholds: {

        lines: 78,

        functions: 80,

        branches: 68,

        statements: 78,

      },

    },

  },

});


