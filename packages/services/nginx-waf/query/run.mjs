#!/usr/bin/env node
/**
 * Query nginx WAF health on configured nodes.
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  nginxWafGlobalSettings,
  normalizeNginxWafConfig,
  resolveNginxWafDeployments,
  sshTargetFromDeployment,
} from "../lib/deployments.mjs";
import { createConfigureExec } from "../lib/nginx-waf-configure.mjs";
import { queryCertExpiry } from "../lib/letsencrypt.mjs";
import { queryLiveVhostDrift } from "../lib/nginx-waf-vhost-drift.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

import {
  MODSECURITY_RULES_FILE,
  siteId,
  tlsDomainsFromSites,
} from "../lib/nginx-waf-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/nginx-waf/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}
function readCfg() {
  return ensurePackageConfig().data;
}
function tryCfg() {
  return tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
}

const target = basename(dirname(here));
const verb = basename(here);

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 */
function queryNginxActive(exec) {
  const r = exec.run("systemctl is-active nginx 2>/dev/null || echo inactive", { capture: true });
  const active = r.stdout.trim() === "active";
  return { active, raw: r.stdout.trim() };
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 */
function queryNginxTest(exec) {
  const r = exec.run("nginx -t 2>&1", { capture: true });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim().slice(0, 500) };
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 * @param {ReturnType<typeof nginxWafGlobalSettings>} global
 */
function queryModsecurityStatus(exec, global) {
  if (!global.modsecurityEnabled) {
    return { enabled: false, ok: true };
  }

  const rulesFile = MODSECURITY_RULES_FILE;
  const exists = exec.run(`test -f ${rulesFile}`, { capture: true }).status === 0;

  let ruleEngine = null;
  if (exists) {
    const read = exec.run(`grep -E '^SecRuleEngine' ${rulesFile} 2>/dev/null | head -1`, {
      capture: true,
    });
    const m = read.stdout.trim().match(/^SecRuleEngine\s+(\S+)/);
    ruleEngine = m ? m[1] : null;
  }

  const crsCount = exec.run(
    "sh -c 'ls /usr/share/modsecurity-crs/rules/*.conf 2>/dev/null | wc -l'",
    { capture: true },
  );
  const crsRuleFiles = Number.parseInt(crsCount.stdout.trim(), 10) || 0;

  const modProbe = exec.run("nginx -V 2>&1", { capture: true });
  const moduleLoaded =
    modProbe.stdout.includes("modsecurity") || modProbe.stderr.includes("modsecurity");

  const auditLog = global.modsecurityAuditLog;
  const auditPresent = exec.run(`test -f ${auditLog}`, { capture: true }).status === 0;

  const ok = exists && crsRuleFiles > 0 && moduleLoaded;
  return {
    enabled: true,
    ok,
    rules_file: rulesFile,
    rules_file_present: exists,
    rule_engine: ruleEngine,
    crs_rule_files: crsRuleFiles,
    module_loaded: moduleLoaded,
    audit_log: auditLog,
    audit_log_present: auditPresent,
  };
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 */
function queryEnabledSites(exec) {
  const r = exec.run("ls -1 /etc/nginx/sites-enabled/hdc-*.conf 2>/dev/null | xargs -r basename -a", {
    capture: true,
  });
  const ids = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^hdc-/, "").replace(/\.conf$/, ""));
  return ids;
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 * @param {string} upstream
 */
function probeUpstream(exec, upstream) {
  const r = exec.run(`curl -fsS -o /dev/null -w '%{http_code}' --connect-timeout 3 ${upstream} 2>/dev/null || echo fail`, {
    capture: true,
  });
  const code = r.stdout.trim();
  return { upstream, ok: code !== "fail" && r.status === 0, http_code: code };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: nginx WAF health check (JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const liveDrift = flagGet(flags, "live") !== undefined;
  const normalized = normalizeNginxWafConfig(cfg);
  const global = nginxWafGlobalSettings(normalized);
  const deployments = resolveNginxWafDeployments(cfg, flags);
  const sites = /** @type {Record<string, unknown>[]} */ (global.sites);
  const domains = tlsDomainsFromSites(sites);

  /** @type {Record<string, unknown>[]} */
  const nodes = [];

  for (const d of deployments) {
    const { user, host } = sshTargetFromDeployment(d);
    errout.write(`[hdc] ${target} ${verb}: checking ${d.systemId} (${d.role}) at ${user}@${host} …\n`);
    const exec = createConfigureExec("ssh", { user, host });
    const nginx = queryNginxActive(exec);
    const configTest = queryNginxTest(exec);
    const modsec = queryModsecurityStatus(exec, global);
    const enabledSites = queryEnabledSites(exec);

    /** @type {Record<string, unknown>[]} */
    const siteProbes = [];
    for (const site of sites) {
      const upstream =
        typeof site.upstream === "string" && site.upstream.trim() ? site.upstream.trim() : "";
      if (upstream) {
        siteProbes.push({
          id: siteId(site),
          probe: probeUpstream(exec, upstream),
        });
      }
    }

    /** @type {Record<string, unknown>[]} */
    const certs = domains.map((domain) => ({
      ...queryCertExpiry(exec, domain),
    }));

    const vhostAudit = liveDrift ? queryLiveVhostDrift(exec, sites) : null;

    nodes.push({
      system_id: d.systemId,
      role: d.role,
      host,
      nginx,
      config_test: configTest,
      modsecurity: modsec,
      enabled_sites: enabledSites,
      site_probes: siteProbes,
      certificates: certs,
      ...(vhostAudit
        ? {
            live_sites: vhostAudit.live_sites,
            vhost_drift: vhostAudit.vhost_drift,
          }
        : {}),
      ok:
        nginx.active &&
        configTest.ok &&
        modsec.ok !== false &&
        (vhostAudit ? vhostAudit.ok : true),
    });
  }

  const ok = nodes.length > 0 && nodes.every((n) => n.ok);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        nodes,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
