import { stderr as errout } from "node:process";

/**
 * @param {string} version
 * @param {string} build
 */
export function splunkDebFilename(version, build) {
  return `splunk-${version}-${build}-linux-2.6-amd64.deb`;
}

/**
 * @param {string} version
 * @param {string} build
 */
export function splunkDownloadUrl(version, build) {
  const name = splunkDebFilename(version, build);
  return `https://download.splunk.com/products/splunk/releases/${version}/linux/${name}`;
}

/**
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.build
 * @param {string} opts.splunkHome
 */
export function buildSplunkInstallScript(opts) {
  const url = splunkDownloadUrl(opts.version, opts.build);
  const deb = splunkDebFilename(opts.version, opts.build);
  const home = opts.splunkHome;
  const versionKey = `${opts.version}-${opts.build}`;
  return [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq curl ca-certificates acl",
    `INSTALLED=$(cat ${home}/.hdc-version 2>/dev/null || true)`,
    `TARGET=${versionKey}`,
    'if [ "$INSTALLED" != "$TARGET" ]; then',
    `  curl -fL# -o /tmp/${deb} ${url}`,
    `  dpkg -i /tmp/${deb} || apt-get install -f -y -qq`,
    `  rm -f /tmp/${deb}`,
    `  echo "$TARGET" > ${home}/.hdc-version`,
    "fi",
    `test -x ${home}/bin/splunk`,
    "",
  ].join("\n");
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.build
 * @param {string} opts.splunkHome
 */
export async function installSplunkOnHost(exec, opts) {
  errout.write(`[hdc] splunk install: ${exec.label} …\n`);
  const script = buildSplunkInstallScript(opts);
  const r = exec.run(script);
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail };
  }
  errout.write(`[hdc] splunk install: completed on ${exec.label}.\n`);
  return { ok: true, message: "installed" };
}
