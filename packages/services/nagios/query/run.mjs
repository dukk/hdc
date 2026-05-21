import {
  nagiosRepoRoot,
  centralClusterDocument,
  nagiosMonitoredSystems,
  primaryProxmoxClusterId,
} from "../lib/repo.mjs";
import { asObject, buildNagiosBundle, resolveCentral } from "../lib/generate.mjs";
import { sshRemote } from "../lib/remote.mjs";

function main() {
  const root = nagiosRepoRoot();
  const bundle = buildNagiosBundle(loadSidecars(root), primaryProxmoxClusterId(root));
  /** @type {Record<string, unknown>} */
  const payload = {
    target: "nagios",
    verb: "query",
    ok: true,
    stub: false,
    generated_at: new Date().toISOString(),
    stats: bundle.stats,
    central: /** @type {Record<string, unknown> | null} */ (null),
  };

  let cluster;
  try {
    cluster = asObject(centralClusterDocument(root));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    payload.ok = false;
    payload.error = `nagios config: ${msg}`;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
  }

  try {
    const central = resolveCentral(cluster);
    payload.central = { ssh_host: central.sshHost, nrpe_allowed: central.nrpeAllowedHost };
    const ver = sshRemote(central.sshUser, central.sshHost, "/usr/sbin/nagios4 -V", { capture: true });
    payload.central_nagios4_V = ver.status === 0 ? ver.stdout.trim() : null;
    payload.central_ssh_ok = ver.status === 0;
    if (ver.status !== 0) {
      payload.central_ssh_stderr = ver.stderr.trim();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    payload.ok = false;
    payload.error = msg;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/** @param {string} root */
function loadSidecars(root) {
  return nagiosMonitoredSystems(root);
}

main();
