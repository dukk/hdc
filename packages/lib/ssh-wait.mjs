import { sshRemote } from "./pve-pct-remote.mjs";

/**
 * Wait until SSH accepts connections.
 * @param {object} opts
 * @param {string} opts.user
 * @param {string} opts.host
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.intervalMs]
 */
export async function waitForSsh(opts) {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  const probe = "echo hdc-ssh-ready";
  while (Date.now() < deadline) {
    const r = sshRemote(opts.user, opts.host, probe, { capture: true });
    if (r.status === 0 && r.stdout.includes("hdc-ssh-ready")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`SSH not ready on ${opts.user}@${opts.host} within ${timeoutMs}ms`);
}
