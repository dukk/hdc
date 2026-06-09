#!/usr/bin/env node
/**
 * Bootstrap waf-maps.conf + waf-global.conf on nginx-waf nodes when nginx -t fails
 * before maintain can upload them (chicken-and-egg with $connection_upgrade).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { repoRoot } from "../paths.mjs";
import { loadPackageConfigFromPackageRoot } from "../lib/package-config.mjs";
import {
  normalizeNginxWafConfig,
  resolveNginxWafGroups,
} from "../../../packages/services/nginx-waf/lib/deployments.mjs";
import { groupUsesModsecurity } from "../../../packages/services/nginx-waf/lib/nginx-waf-policies.mjs";
import {
  renderHdcNginxInclude,
  renderHdcNginxMaps,
  sitesNeedWebsocketMap,
} from "../../../packages/services/nginx-waf/lib/nginx-waf-render.mjs";

const root = repoRoot();
const packageRoot = join(root, "packages", "services", "nginx-waf");
const pkg = loadPackageConfigFromPackageRoot(packageRoot, {
  exampleRel: "packages/services/nginx-waf/config.example.json",
});
const groupId = process.argv[2] || "public";
const hosts = process.argv.slice(3);
if (!hosts.length) {
  console.error("Usage: upload-waf-maps-bootstrap.mjs [group] <host> …");
  process.exit(1);
}

normalizeNginxWafConfig(pkg.data);
const ctx = resolveNginxWafGroups(pkg.data, { group: groupId })[0];
if (!ctx) throw new Error(`group ${groupId} not found`);
const global = ctx.global;
const plan = global.groupPolicyPlan;
const maps = renderHdcNginxMaps({
  websocketMapEnabled: sitesNeedWebsocketMap(ctx.sites),
  blockCommonExploits: plan.blockCommonExploits,
  rateLimitZones: plan.rateLimitZones || [],
});
const include = renderHdcNginxInclude({
  modsecurityEnabled: global.modsecurityEnabled && groupUsesModsecurity(plan),
});

/**
 * @param {string} host
 * @param {string} remotePath
 * @param {string} content
 */
function upload(host, remotePath, content) {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  const inner = `echo '${b64.replace(/'/g, `'\\''`)}' | base64 -d | sudo tee ${remotePath} > /dev/null`;
  const r = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", `hdc@${host}`, inner],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`${host}: upload ${remotePath}: ${r.stderr || r.stdout}`);
  }
}

for (const host of hosts) {
  upload(host, "/etc/nginx/hdc/waf-maps.conf", maps);
  upload(host, "/etc/nginx/hdc/waf-global.conf", include);
  const t = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", `hdc@${host}`, "sudo nginx -t 2>&1"],
    { encoding: "utf8" },
  );
  const out = `${t.stdout}${t.stderr}`.trim();
  console.log(`${host}: nginx -t exit ${t.status}\n${out}`);
  if (t.status !== 0) process.exitCode = 1;
}
