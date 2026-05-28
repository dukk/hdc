import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import { resolveSiteAccessSettings } from "./deployments.mjs";
import {
  MODSECURITY_RULES_FILE,
  renderHdcNginxInclude,
  renderModsecurityMainConf,
  renderSiteVhost,
  serverNames,
  siteId,
} from "./nginx-waf-render.mjs";
import { certExistsOnHost } from "./letsencrypt.mjs";

export { createConfigureExec };

/**
 * @param {string} s
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 * @param {string} cmd
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
function runChecked(exec, cmd, log) {
  log.info(`${exec.label}: ${cmd.split("\n")[0].slice(0, 120)}`);
  const r = exec.run(cmd, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    throw new Error(detail);
  }
  return r;
}

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 * @param {string} remotePath
 * @param {string} content
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
function uploadFile(exec, remotePath, content, log) {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  runChecked(exec, `echo ${shellQuote(b64)} | base64 -d > ${shellQuote(remotePath)}`, log);
}

/**
 * Upload hdc-waf.conf with OWASP CRS includes and verify CRS paths on the host.
 * @param {object} opts
 * @param {ReturnType<typeof createConfigureExec>} opts.exec
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} opts.log
 * @param {ReturnType<typeof import("./deployments.mjs").nginxWafGlobalSettings>} opts.global
 * @param {boolean} [opts.verifyPackages]
 */
export function configureModsecurityCrs(opts) {
  const { exec, log, global, verifyPackages = true } = opts;
  if (!global.modsecurityEnabled) {
    return { configured: false };
  }

  if (verifyPackages) {
    runChecked(exec, `test -f ${shellQuote(global.modsecurityCrsSetup)}`, log);
    const rulesCheck = exec.run(
      `sh -c 'ls ${global.modsecurityCrsRulesGlob.replace(/'/g, `'\\''`)} 2>/dev/null | head -1'`,
      { capture: true },
    );
    if (rulesCheck.status !== 0 || !rulesCheck.stdout.trim()) {
      throw new Error(
        `OWASP CRS rules not found at ${global.modsecurityCrsRulesGlob} — install modsecurity-crs package`,
      );
    }
    if (global.modsecurityUnicodeMap) {
      runChecked(exec, `test -f ${shellQuote(global.modsecurityUnicodeMap)}`, log);
    }
  }

  const conf = renderModsecurityMainConf({
    ruleEngine: global.modsecurityRuleEngine,
    crsSetup: global.modsecurityCrsSetup,
    crsRulesGlob: global.modsecurityCrsRulesGlob,
    unicodeMap: global.modsecurityUnicodeMap,
    auditLog: global.modsecurityAuditLog,
  });
  runChecked(exec, "mkdir -p /etc/modsecurity", log);
  uploadFile(exec, MODSECURITY_RULES_FILE, conf, log);
  runChecked(exec, `chmod 644 ${shellQuote(MODSECURITY_RULES_FILE)}`, log);
  runChecked(exec, "mkdir -p /var/log/nginx", log);
  runChecked(
    exec,
    `touch ${shellQuote(global.modsecurityAuditLog)} && chown www-data:adm ${shellQuote(global.modsecurityAuditLog)} 2>/dev/null || chown www-data:www-data ${shellQuote(global.modsecurityAuditLog)} 2>/dev/null || true`,
    log,
  );

  const modProbe = exec.run("nginx -V 2>&1", { capture: true });
  const modLoaded =
    modProbe.stdout.includes("modsecurity") || modProbe.stderr.includes("modsecurity");
  log.info(`ModSecurity nginx module loaded: ${modLoaded ? "yes" : "unknown"}`);

  return {
    configured: true,
    rules_file: MODSECURITY_RULES_FILE,
    rule_engine: global.modsecurityRuleEngine,
  };
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof createConfigureExec>} opts.exec
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} opts.log
 * @param {ReturnType<typeof import("./deployments.mjs").nginxWafGlobalSettings>} opts.global
 * @param {boolean} [opts.dns01]
 */
export function installNginxWafBase(opts) {
  const { exec, log, global, dns01 } = opts;
  const pkgs = [
    "nginx",
    "libmodsecurity3",
    "libnginx-mod-http-modsecurity",
    "modsecurity-crs",
    "certbot",
    "python3-certbot-nginx",
    "rsync",
    "openssh-client",
  ];
  if (dns01) pkgs.push("python3-certbot-dns-rfc2136");
  runChecked(
    exec,
    `export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y ${pkgs.join(" ")}`,
    log,
  );
  runChecked(exec, "mkdir -p /etc/nginx/hdc /var/www/letsencrypt", log);
  const include = renderHdcNginxInclude({
    modsecurityEnabled: global.modsecurityEnabled,
  });
  uploadFile(exec, "/etc/nginx/hdc/waf-global.conf", include, log);
  runChecked(
    exec,
    `grep -q 'hdc/waf-global.conf' /etc/nginx/nginx.conf || ` +
      `sed -i '/http {/a\\    include /etc/nginx/hdc/waf-global.conf;' /etc/nginx/nginx.conf`,
    log,
  );
  runChecked(
    exec,
    "test -f /etc/letsencrypt/options-ssl-nginx.conf || " +
      "cp /usr/lib/python3/dist-packages/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf " +
      "/etc/letsencrypt/options-ssl-nginx.conf 2>/dev/null || true",
    log,
  );
  runChecked(
    exec,
    "test -f /etc/letsencrypt/ssl-dhparams.pem || " +
      "openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 2>/dev/null || true",
    log,
  );

  if (global.modsecurityEnabled) {
    configureModsecurityCrs({ exec, log, global, verifyPackages: true });
  }
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof createConfigureExec>} opts.exec
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} opts.log
 * @param {ReturnType<typeof import("./deployments.mjs").nginxWafGlobalSettings>} opts.global
 * @param {Record<string, unknown>[]} opts.sites
 * @param {boolean} [opts.pruneStaleSites] Remove hdc-* vhosts on host not in sites[] (default true)
 * @param {string} [opts.wafNodeId] deployment.system_id baked into upstream headers
 */
export function configureNginxWafSites(opts) {
  const { exec, log, global, sites, pruneStaleSites = true, wafNodeId } = opts;
  runChecked(exec, "mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled", log);

  const http01 = global.challenge === "http-01";
  /** @type {string[]} */
  const enabledIds = [];

  for (const site of sites) {
    const id = siteId(site);
    const tls = site.tls && typeof site.tls === "object" ? site.tls : {};
    const certName =
      typeof tls.cert_name === "string" && tls.cert_name.trim()
        ? tls.cert_name.trim()
        : serverNames(site)[0];
    const deferTls =
      tls.enabled !== false && http01 && !certExistsOnHost(exec, certName);
    const access = resolveSiteAccessSettings(site, global);
    const vhost = renderSiteVhost({
      site,
      modsecurityEnabled: global.modsecurityEnabled,
      http01Acme: http01,
      webroot: global.webroot,
      deferTlsUntilCertExists: deferTls,
      trustedCidrs: access.trustedCidrs,
      clientIp: access.clientIp,
      cloudflareIpv4: access.cloudflareIpv4,
      wafNodeId,
    });
    const avail = `/etc/nginx/sites-available/hdc-${id}.conf`;
    uploadFile(exec, avail, vhost, log);
    runChecked(exec, `ln -sf ${shellQuote(avail)} /etc/nginx/sites-enabled/hdc-${id}.conf`, log);
    enabledIds.push(id);
  }

  if (pruneStaleSites) {
    const list = runChecked(
      exec,
      "ls -1 /etc/nginx/sites-enabled/hdc-*.conf 2>/dev/null || true",
      log,
    );
    const existing = list.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((p) => {
        const m = p.match(/hdc-([^.]+)\.conf$/);
        return m ? m[1] : null;
      })
      .filter(Boolean);

    for (const oldId of existing) {
      if (!enabledIds.includes(/** @type {string} */ (oldId))) {
        runChecked(
          exec,
          `rm -f /etc/nginx/sites-enabled/hdc-${oldId}.conf /etc/nginx/sites-available/hdc-${oldId}.conf`,
          log,
        );
        log.info(`removed stale site ${oldId}`);
      }
    }
  }

  runChecked(exec, "nginx -t", log);
  runChecked(
    exec,
    "systemctl enable nginx && (systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx)",
    log,
  );
  return { enabled_site_ids: enabledIds, prune_stale_sites: pruneStaleSites };
}

/**
 * Full configure: base + sites.
 * @param {object} opts
 * @param {ReturnType<typeof createConfigureExec>} opts.exec
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} opts.log
 * @param {ReturnType<typeof import("./deployments.mjs").nginxWafGlobalSettings>} opts.global
 * @param {Record<string, unknown>[]} opts.sites
 * @param {boolean} [opts.skipBaseInstall]
 * @param {string} [opts.wafNodeId]
 */
export function configureNginxWaf(opts) {
  const { exec, log, global, sites, skipBaseInstall, wafNodeId } = opts;
  if (!skipBaseInstall) {
    installNginxWafBase({ exec, log, global, dns01: global.challenge === "dns-01" });
  } else if (global.modsecurityEnabled) {
    configureModsecurityCrs({ exec, log, global, verifyPackages: false });
  }
  const sitesResult = configureNginxWafSites({ exec, log, global, sites, wafNodeId });
  return { ...sitesResult };
}

/**
 * Re-apply OWASP CRS ModSecurity config without apt (maintain default path).
 * @param {object} opts
 * @param {ReturnType<typeof createConfigureExec>} opts.exec
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} opts.log
 * @param {ReturnType<typeof import("./deployments.mjs").nginxWafGlobalSettings>} opts.global
 */
export function maintainModsecurityCrs(opts) {
  const { exec, log, global } = opts;
  if (!global.modsecurityEnabled) return { configured: false };
  return configureModsecurityCrs({ exec, log, global, verifyPackages: false });
}
