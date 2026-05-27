import { sshRemote } from "../../../lib/pve-pct-remote.mjs";

/**
 * @param {string} user
 * @param {string} host
 * @param {string} innerCommand
 */
export function sshCapture(user, host, innerCommand) {
  const escaped = innerCommand.replace(/'/g, `'\\''`);
  return sshRemote(user, host, `bash -lc '${escaped}'`, { capture: true });
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryNamedActive(user, host) {
  const r = sshCapture(user, host, "systemctl is-active named 2>/dev/null || echo inactive");
  return {
    ok: r.status === 0,
    active: r.stdout.trim() === "active",
    raw: r.stdout.trim(),
  };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {string} zone
 * @param {string} [server] dig @server; defaults to host.
 */
export function querySoa(user, host, zone, server) {
  const at = server ? `@${server}` : `@${host}`;
  const r = sshCapture(user, host, `dig +short SOA ${zone} ${at} 2>/dev/null | head -1`);
  const line = r.stdout.trim();
  const serial = line ? line.split(/\s+/)[2] ?? "" : "";
  return { ok: r.status === 0 && Boolean(line), soa: line, serial };
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for slave SOA serial to match master after a primary zone push (NOTIFY / IXFR).
 * @param {object} opts
 * @param {string} opts.zone
 * @param {string} opts.primaryUser
 * @param {string} opts.primaryHost
 * @param {string} opts.secondaryUser
 * @param {string} opts.secondaryHost
 * @param {(line: string) => void} [opts.log]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.intervalMs]
 */
export async function waitForSoaSerialMatch(opts) {
  const maxAttempts = opts.maxAttempts ?? 15;
  const intervalMs = opts.intervalMs ?? 2000;
  const log = opts.log ?? (() => {});

  /** @type {{ primary_serial: string; secondary_serial: string }} */
  let last = { primary_serial: "", secondary_serial: "" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const primarySoa = querySoa(opts.primaryUser, opts.primaryHost, opts.zone);
    const secondarySoa = querySoa(opts.secondaryUser, opts.secondaryHost, opts.zone);
    last = { primary_serial: primarySoa.serial, secondary_serial: secondarySoa.serial };
    const serialMatch =
      primarySoa.ok &&
      secondarySoa.ok &&
      primarySoa.serial &&
      primarySoa.serial === secondarySoa.serial;
    if (serialMatch) {
      return {
        ok: true,
        zone: opts.zone,
        primary_serial: primarySoa.serial,
        secondary_serial: secondarySoa.serial,
        serial_match: true,
        attempts: attempt,
      };
    }
    if (attempt === 1) {
      log(
        `SOA mismatch for ${opts.zone} (primary ${primarySoa.serial} vs secondary ${secondarySoa.serial}); rndc retransfer on secondary`,
      );
      sshCapture(opts.secondaryUser, opts.secondaryHost, `rndc retransfer ${opts.zone} 2>/dev/null || true`);
    } else {
      log(`waiting for SOA sync (${attempt}/${maxAttempts})`);
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    zone: opts.zone,
    primary_serial: last.primary_serial,
    secondary_serial: last.secondary_serial,
    serial_match: false,
    attempts: maxAttempts,
  };
}
