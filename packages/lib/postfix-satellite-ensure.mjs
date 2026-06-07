import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";
import {
  loadMailRelayClientDefaults,
  resolveSatelliteMyhostname,
} from "./mail-relay-config.mjs";
import { configurePostfixSatellite } from "../services/postfix-relay/lib/postfix-satellite-configure.mjs";

/**
 * @typedef {import("./clamav-ensure.mjs").ConfigureExec} ConfigureExec
 */

/**
 * @typedef {object} PostfixSatelliteEnsureResult
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} message
 * @property {Record<string, unknown>} [details]
 */

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, string>} [flags]
 * @returns {boolean}
 */
export function mailRelaySkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-mail-relay", "skip_mail_relay") !== undefined;
}

/**
 * @param {Record<string, unknown> | undefined} deployment
 * @param {string} relaySystemId
 * @returns {boolean}
 */
export function shouldSkipMailRelayForDeployment(deployment, relaySystemId) {
  if (!deployment || !isObject(deployment)) return false;
  const sid =
    typeof deployment.system_id === "string"
      ? deployment.system_id.trim()
      : typeof deployment.systemId === "string"
        ? deployment.systemId.trim()
        : "";
  return Boolean(sid && relaySystemId && sid === relaySystemId);
}

/** @returns {string} */
export function postfixInstalledCheckCommand() {
  return "dpkg -s postfix >/dev/null 2>&1";
}

/**
 * @param {ConfigureExec} exec
 * @param {string} relayhost
 * @param {{ info: (msg: string) => void }} log
 * @returns {boolean}
 */
function satelliteAlreadyConfigured(exec, relayhost, log) {
  const r = exec.run("postconf -h relayhost 2>/dev/null || true", { capture: true });
  const live = `${r.stdout}`.trim();
  const want = relayhost.trim();
  if (live === want) {
    log.info(`${exec.label}: Postfix satellite already configured (relayhost ${want})`);
    return true;
  }
  return false;
}

/**
 * Idempotent Postfix satellite install pointing at the internal hdc mail relay.
 *
 * @param {object} opts
 * @param {ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {Record<string, unknown>} [opts.deployment]
 * @param {import("./mail-relay-config.mjs").MailRelayClientDefaults} [opts.clientDefaults]
 * @returns {Promise<PostfixSatelliteEnsureResult>}
 */
export async function ensurePostfixSatellite(opts) {
  const { exec, log, flags, deployment } = opts;
  const defaults = opts.clientDefaults ?? loadMailRelayClientDefaults();

  if (mailRelaySkippedByFlags(flags)) {
    log.info(`${exec.label}: mail relay skipped (--skip-mail-relay)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  if (shouldSkipMailRelayForDeployment(deployment, defaults.relay_system_id)) {
    log.info(`${exec.label}: mail relay skipped (relay host ${defaults.relay_system_id})`);
    return { ok: true, skipped: true, message: "skipped on relay host" };
  }

  const myorigin = defaults.myorigin;
  const myhostname = resolveSatelliteMyhostname(
    deployment && isObject(deployment) ? deployment : undefined,
    myorigin,
  );
  const relayhost = defaults.relayhost;

  try {
    if (satelliteAlreadyConfigured(exec, relayhost, log)) {
      return {
        ok: true,
        skipped: false,
        message: "already configured",
        details: { relayhost, myhostname, myorigin },
      };
    }

    const installed = exec.run(postfixInstalledCheckCommand(), { capture: true }).status === 0;
    if (!installed) {
      const lock = await waitForAptLock(exec, log);
      if (!lock.ok) {
        return { ok: false, skipped: false, message: lock.message };
      }
    }

    const result = configurePostfixSatellite({
      exec,
      log,
      relayhost,
      myhostname,
      myorigin,
      inetInterfaces: defaults.inet_interfaces,
    });

    return {
      ok: true,
      skipped: false,
      message: result.message,
      details: result.details,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${exec.label}: mail relay ensure failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
