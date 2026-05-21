import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  renderMainCfSnippet,
  renderSaslPasswd,
  relayhostForSaslMap,
} from "./postfix-relay-render.mjs";
import { pctExec, sshRemote } from "./remote.mjs";

/**
 * @typedef {object} ConfigureExec
 * @property {(inner: string, opts?: { capture?: boolean }) => { status: number; stdout: string; stderr: string }} run
 * @property {string} label Safe description for logs (no secrets).
 */

/**
 * @param {"pct" | "ssh"} via
 * @param {{ user: string; host: string; vmid?: number; pveHost?: string }} target
 */
export function createConfigureExec(via, target) {
  if (via === "pct") {
    const vmid = target.vmid;
    const pveHost = target.pveHost ?? target.host;
    if (!Number.isFinite(vmid) || vmid <= 0) {
      throw new Error("pct configure requires a positive numeric vmid");
    }
    return /** @type {ConfigureExec} */ ({
      label: `pct exec ${vmid} on ${target.user}@${pveHost}`,
      run: (inner, opts) => pctExec(target.user, pveHost, Number(vmid), inner, opts),
    });
  }
  return /** @type {ConfigureExec} */ ({
    label: `ssh ${target.user}@${target.host}`,
    run: (inner, opts) => sshRemote(target.user, target.host, `bash -lc ${shellQuote(inner)}`, opts),
  });
}

/**
 * @param {string} s
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {ConfigureExec} exec
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
 * @param {object} opts
 * @param {ConfigureExec} opts.exec
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} opts.log
 * @param {Record<string, unknown>} opts.postfix
 * @param {Record<string, unknown>} opts.smtp
 * @param {string} opts.smtpUser
 * @param {string} opts.smtpPass
 */
export function configurePostfixRelay(opts) {
  const { exec, log, postfix, smtp, smtpUser, smtpPass } = opts;

  const relayhost = typeof smtp.relayhost === "string" ? smtp.relayhost.trim() : "";
  if (!relayhost) throw new Error("smtp.relayhost is required");

  const myhostname =
    (typeof postfix.myhostname === "string" && postfix.myhostname.trim()) || "postfix-relay";
  const myorigin = (typeof postfix.myorigin === "string" && postfix.myorigin.trim()) || myhostname;
  const mynetworks =
    (typeof postfix.mynetworks === "string" && postfix.mynetworks.trim()) ||
    "127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128";
  const inetInterfaces =
    typeof postfix.inet_interfaces === "string" && postfix.inet_interfaces.trim()
      ? postfix.inet_interfaces.trim()
      : "all";
  const tlsLevel =
    typeof smtp.tls_security_level === "string" && smtp.tls_security_level.trim()
      ? smtp.tls_security_level.trim()
      : "encrypt";

  const mainSnippet = renderMainCfSnippet({
    relayhost,
    tlsSecurityLevel: tlsLevel,
    myhostname,
    myorigin,
    mynetworks,
    inetInterfaces,
  });
  const saslBody = renderSaslPasswd(relayhostForSaslMap(relayhost), smtpUser, smtpPass);

  const tmp = mkdtempSync(join(tmpdir(), "hdc-postfix-relay-"));
  const localMain = join(tmp, "hdc-relay.cf");
  const localSasl = join(tmp, "sasl_passwd");
  try {
    writeFileSync(localMain, mainSnippet, "utf8");
    writeFileSync(localSasl, saslBody, "utf8");
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }

  try {
    runChecked(
      exec,
      "export DEBIAN_FRONTEND=noninteractive; " +
        "echo 'postfix postfix/mailname string " +
        myhostname.replace(/'/g, `'\\''`) +
        "' | debconf-set-selections; " +
        "echo 'postfix postfix/main_mailer_type string Satellite system' | debconf-set-selections; " +
        "apt-get update -qq && apt-get install -y postfix libsasl2-modules ca-certificates",
      log,
    );

    const mainB64 = Buffer.from(mainSnippet, "utf8").toString("base64");
    const saslB64 = Buffer.from(saslBody, "utf8").toString("base64");
    runChecked(exec, "mkdir -p /etc/postfix/main.cf.d", log);
    runChecked(
      exec,
      `echo ${shellQuote(mainB64)} | base64 -d > /etc/postfix/main.cf.d/hdc-relay.cf`,
      log,
    );
    runChecked(
      exec,
      `echo ${shellQuote(saslB64)} | base64 -d > /etc/postfix/sasl_passwd && chmod 600 /etc/postfix/sasl_passwd`,
      log,
    );
    runChecked(exec, "postmap /etc/postfix/sasl_passwd", log);
    log.info("postmap wrote /etc/postfix/sasl_passwd.db");
    runChecked(
      exec,
      "postfix check && systemctl enable postfix && systemctl reload postfix",
      log,
    );
    log.info("Postfix relay configured (SMTP2GO smarthost) and reloaded.");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    message: `Postfix relay configured (${exec.label})`,
    details: { relayhost, myhostname, myorigin },
  };
}
