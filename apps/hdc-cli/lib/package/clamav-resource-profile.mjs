/** @typedef {"lean" | "standard" | "full"} ClamavProfile */

export const CLAMAV_PROFILE_LEAN_MAX_MB = 3072;
export const CLAMAV_PROFILE_STANDARD_MAX_MB = 8191;

/**
 * @param {number | undefined} memoryMb Guest memory_mb from clump config (QEMU or LXC).
 * @returns {ClamavProfile}
 */
export function resolveClamavProfile(memoryMb) {
  if (memoryMb === undefined || !Number.isFinite(memoryMb) || memoryMb <= 0) {
    return "lean";
  }
  if (memoryMb <= CLAMAV_PROFILE_LEAN_MAX_MB) return "lean";
  if (memoryMb <= CLAMAV_PROFILE_STANDARD_MAX_MB) return "standard";
  return "full";
}

/**
 * @param {ClamavProfile} profile
 * @returns {string[]}
 */
export function clamavAptPackagesForProfile(profile) {
  if (profile === "lean") return ["clamav", "clamav-freshclam"];
  return ["clamav", "clamav-daemon", "clamav-freshclam"];
}

/**
 * @param {ClamavProfile} profile
 * @returns {string}
 */
export function clamavAptInstallCommandForProfile(profile) {
  const packages = clamavAptPackagesForProfile(profile).join(" ");
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    `apt-get install -y -qq ${packages}`,
  ].join(" && ");
}

/**
 * @param {string} dir
 * @param {string} path
 * @param {string | null} content null removes the drop-in
 */
function dropInWriteFragment(dir, path, content) {
  if (content === null) {
    return `rm -f ${path}`;
  }
  const escaped = content.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
  return `mkdir -p ${dir} && printf '%s' '${escaped}' > ${path}`;
}

/**
 * @param {ClamavProfile} profile
 * @returns {string}
 */
export function clamavConfigApplyCommandForProfile(profile) {
  const clamdDir = "/etc/clamav/clamd.conf.d";
  const clamdPath = `${clamdDir}/99-hdc.conf`;
  const freshclamDir = "/etc/clamav/freshclam.conf.d";
  const freshclamPath = `${freshclamDir}/99-hdc.conf`;
  const parts = [];

  if (profile === "standard") {
    parts.push(
      dropInWriteFragment(clamdDir, clamdPath, "MaxThreads 4\nConcurrentDatabaseReload no\n"),
    );
    parts.push(dropInWriteFragment(freshclamDir, freshclamPath, null));
  } else if (profile === "lean") {
    parts.push(dropInWriteFragment(clamdDir, clamdPath, null));
    parts.push(dropInWriteFragment(freshclamDir, freshclamPath, "Checks 2\n"));
  } else {
    parts.push(dropInWriteFragment(clamdDir, clamdPath, null));
    parts.push(dropInWriteFragment(freshclamDir, freshclamPath, null));
  }

  return parts.join(" && ");
}

/**
 * @param {ClamavProfile} profile
 * @returns {string}
 */
export function clamavDaemonPackageInstallCommand() {
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq clamav-daemon",
  ].join(" && ");
}

/**
 * @param {ClamavProfile} profile
 * @returns {string}
 */
export function clamavEnableServicesCommandForProfile(profile) {
  const lines = [
    "systemctl enable clamav-freshclam 2>/dev/null || true",
    "systemctl start clamav-freshclam 2>/dev/null || true",
  ];

  if (profile === "lean") {
    lines.push(
      "systemctl stop clamav-daemon 2>/dev/null || true",
      "systemctl disable clamav-daemon 2>/dev/null || true",
      "systemctl mask clamav-daemon 2>/dev/null || true",
    );
  } else {
    lines.push(
      "systemctl unmask clamav-daemon 2>/dev/null || true",
      "if systemctl list-unit-files clamav-daemon.service >/dev/null 2>&1; then",
      "  systemctl enable clamav-daemon 2>/dev/null || true",
      "  systemctl start clamav-daemon 2>/dev/null || true",
      "fi",
    );
  }

  return lines.join("\n");
}

/**
 * @param {ClamavProfile} profile
 * @returns {string}
 */
export function clamavDaemonInstalledCheckCommand() {
  return "dpkg -s clamav-daemon >/dev/null 2>&1";
}
