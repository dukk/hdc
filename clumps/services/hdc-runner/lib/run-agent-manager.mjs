#!/usr/bin/env node
/**
 * Manager orchestration — installed on hdc-runner guest at
 * /opt/hdc-runner/bin/run-agent-manager.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const META_ROOT = process.env.HDC_RUNNER_META_ROOT || "/opt/hdc-runner";
const INSTALL_ROOT = process.env.HDC_RUNNER_INSTALL_ROOT || "/opt/hdc";
const PRIVATE_ROOT = process.env.HDC_RUNNER_PRIVATE_ROOT || "/opt/hdc-private";

/**
 * @param {string} path
 */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

async function main() {
  loadDotEnv(join(META_ROOT, ".env"));
  process.env.HDC_PRIVATE_ROOT = PRIVATE_ROOT;

  const apiKey = String(process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    process.stderr.write("CURSOR_API_KEY not set in hdc-runner .env\n");
    process.exit(1);
  }

  const maxConcurrent = Number(process.env.HDC_RUNNER_MAX_AGENT_RUNS ?? "1") || 1;
  const source = process.argv[2]?.trim() || "agent-manager-hourly";

  const managerUrl = pathToFileURL(
    join(INSTALL_ROOT, "clumps/services/hdc-runner/lib/hdc-runner-agent-manager.mjs"),
  ).href;
  const { runManagerCycle } = await import(managerUrl);

  process.stderr.write(`[hdc-runner] manager cycle started (${source})\n`);
  const result = await runManagerCycle({
    installRoot: INSTALL_ROOT,
    privateRoot: PRIVATE_ROOT,
    apiKey,
    maxConcurrent,
    source,
  });

  process.stderr.write(
    `[hdc-runner] manager cycle finished ok=${result.ok} workers=${result.workers.length}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
