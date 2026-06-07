import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";
import { staggerOffsetFromSystemId } from "./guest-systemd-unit-ensure.mjs";

/**
 * @param {Record<string, string>} [flags]
 */
export function unattendedUpgradesSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-unattended-upgrades", "skip_unattended_upgrades") !== undefined;
}

/** @returns {string} */
export function unattendedUpgradesInstalledCheckCommand() {
  return "dpkg -s unattended-upgrades >/dev/null 2>&1";
}

/**
 * @param {string} systemId
 * @param {number} randomSleepSec
 */
export function buildUnattendedUpgradesConfigSnippet(systemId, randomSleepSec) {
  const sleep = Math.max(0, Math.min(3600, Math.floor(randomSleepSec)));
  return [
    'Unattended-Upgrade::Automatic-Reboot "false";',
    `Unattended-Upgrade::RandomSleep "${sleep}";`,
    "// hdc-maintain: system " + systemId,
  ].join("\n");
}

/**
 * @param {string} systemId
 */
export function unattendedUpgradesInstallCommand(systemId) {
  const { randomSleepSec } = staggerOffsetFromSystemId(systemId, 1440);
  const snippet = buildUnattendedUpgradesConfigSnippet(systemId, randomSleepSec);
  const dropIn = snippet.replace(/'/g, `'\\''`);
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq unattended-upgrades apt-listchanges",
    "dpkg-reconfigure -f noninteractive unattended-upgrades || true",
    "mkdir -p /etc/apt/apt.conf.d",
    "cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'",
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Download-Upgradeable-Packages "1";',
    'APT::Periodic::AutocleanInterval "7";',
    'APT::Periodic::Unattended-Upgrade "1";',
    "EOF",
    `cat > /etc/apt/apt.conf.d/52hdc-unattended-upgrades <<'EOF'`,
    snippet,
    "EOF",
  ].join("\n");
}

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {string} [opts.systemId]
 */
export async function ensureUnattendedUpgrades(opts) {
  if (unattendedUpgradesSkippedByFlags(opts.flags)) {
    opts.log.info(`${opts.exec.label}: unattended-upgrades skipped (--skip-unattended-upgrades)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const systemId = String(opts.systemId ?? "unknown").trim() || "unknown";
  const check = opts.exec.run(unattendedUpgradesInstalledCheckCommand(), { capture: true });
  const already = check.status === 0;

  try {
    if (!already) {
      const lock = await waitForAptLock(opts.exec, opts.log);
      if (!lock.ok) {
        return { ok: false, skipped: false, message: lock.message };
      }
      opts.log.info(`${opts.exec.label}: installing unattended-upgrades`);
    } else {
      opts.log.info(`${opts.exec.label}: unattended-upgrades already installed — re-applying config`);
    }

    const cmd = unattendedUpgradesInstallCommand(systemId);
    const preview = cmd.split("\n")[0].slice(0, 80);
    opts.log.info(`${opts.exec.label}: ${preview}`);
    const r = opts.exec.run(cmd, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    const { randomSleepSec } = staggerOffsetFromSystemId(systemId, 1440);
    return {
      ok: true,
      skipped: false,
      message: already ? "config ensured" : "installed",
      random_sleep_sec: randomSleepSec,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${opts.exec.label}: unattended-upgrades failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
