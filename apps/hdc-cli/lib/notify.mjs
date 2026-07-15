#!/usr/bin/env node
/**
 * Post a manager notification to configured channels for a route.
 *
 * Usage:
 *   node apps/hdc-cli/lib/notify.mjs --route needs_decision --title "HDC" --message "…"
 *   node apps/hdc-cli/lib/notify.mjs --route mailbox_received --message "…" --silent
 *   node apps/hdc-cli/lib/notify.mjs --route needs_decision --decision --task-id foo --message "…"
 */
import "./package/preload.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout } from "node:process";

import { loadDotenv } from "../env.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { createNodeCliDeps } from "./node-cli-deps.mjs";
import { loadNotificationsConfigFromFiles } from "./notifications-config.mjs";
import { MANAGER_ROUTE_KEYS, sendNotifyRoute } from "./ops-notify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
 *   route: string,
 *   title: string,
 *   message: string,
 *   dryRun: boolean,
 *   silent: boolean,
 *   decision: boolean,
 *   taskId: string,
 * }} */
  const out = {
    route: "",
    title: "HDC",
    message: "",
    dryRun: false,
    silent: false,
    decision: false,
    taskId: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--silent") out.silent = true;
    else if (a === "--decision") out.decision = true;
    else if (a === "--route" && argv[i + 1]) out.route = String(argv[++i]);
    else if (a === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (a === "--message" && argv[i + 1]) out.message = String(argv[++i]);
    else if ((a === "--task-id" || a === "--task_id") && argv[i + 1]) out.taskId = String(argv[++i]);
    else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: notify.mjs --route <key> --message <text> [--title <text>] [--dry-run] [--silent]\n" +
          "       [--decision --task-id <id>]\n" +
          `routes: ${MANAGER_ROUTE_KEYS.join(", ")}\n`,
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { route, title, message, dryRun, silent, decision, taskId } = parseArgs(process.argv.slice(2));
  if (!route.trim()) {
    stderr.write("notify: --route is required\n");
    process.exit(2);
  }
  if (!MANAGER_ROUTE_KEYS.includes(/** @type {import("./notifications-config.mjs").ManagerRouteKey} */ (route))) {
    stderr.write(`notify: unknown route ${route}\n`);
    process.exit(2);
  }
  if (!message.trim()) {
    stderr.write("notify: --message is required\n");
    process.exit(2);
  }
  if (decision && !taskId.trim()) {
    stderr.write("notify: --task-id is required with --decision\n");
    process.exit(2);
  }

  loadDotenv(join(repoRoot, ".env"));
  loadDotenv(
    join(
      process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta",
      ".env",
    ),
  );

  const privateRoot =
    String(process.env.HDC_PRIVATE_ROOT ?? "").trim() ||
    join(repoRoot, "..", "hdc-private");
  const config = loadNotificationsConfigFromFiles(repoRoot, privateRoot);
  const routeChannels = config.routes[/** @type {import("./notifications-config.mjs").ManagerRouteKey} */ (route)] ?? [];

  if (dryRun) {
    stdout.write(
      `${JSON.stringify({
        ok: true,
        dry_run: true,
        route,
        channels: routeChannels,
        title,
        message_length: message.length,
        decision: decision || undefined,
        task_id: taskId || undefined,
        silent: silent || undefined,
      })}\n`,
    );
    return;
  }

  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));

  const result = await sendNotifyRoute({
    routeKey: /** @type {import("./notifications-config.mjs").ManagerRouteKey} */ (route),
    config,
    title,
    message,
    env: deps.env,
    getSecret: (key, opts) => vault.getSecret(key, opts),
    silent,
    decision,
    taskId,
  });

  if (!result.ok) {
    stderr.write(`notify: no channel delivered for route ${route}\n`);
    stdout.write(JSON.stringify({ ok: false, route, results: result.results }) + "\n");
    process.exit(1);
  }

  stderr.write(`notify: sent route ${route}\n`);
  stdout.write(JSON.stringify({ ok: true, route, results: result.results }) + "\n");
}

main().catch((e) => {
  stderr.write(`notify: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
