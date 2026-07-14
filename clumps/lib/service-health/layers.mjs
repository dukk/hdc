import { spawnSync } from "node:child_process";
import { promises as dnsPromises } from "node:dns";
import { platform } from "node:os";

/**
 * @typedef {{ ok: boolean|null, skipped: boolean, detail?: string, http_code?: number|null, ms?: number }} LayerResult
 */

/**
 * @param {string} hostname
 * @returns {Promise<LayerResult>}
 */
export async function probeDns(hostname) {
  const host = String(hostname ?? "").trim();
  if (!host) {
    return { ok: null, skipped: true, detail: "no hostname" };
  }
  try {
    const addrs = await dnsPromises.lookup(host, { all: true });
    const ips = addrs.map((a) => a.address);
    return {
      ok: ips.length > 0,
      skipped: false,
      detail: ips.length ? ips.join(", ") : "no addresses",
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      detail: String(/** @type {Error} */ (e).message || e),
    };
  }
}

/**
 * @returns {string}
 */
function curlBin() {
  return platform() === "win32" ? "curl.exe" : "curl";
}

/**
 * HTTP(S) probe from the operator host.
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} [opts.hostHeader]
 * @param {number} [opts.timeoutSec]
 * @param {boolean} [opts.insecure]
 * @returns {LayerResult}
 */
export function probeHttp(opts) {
  const url = String(opts.url ?? "").trim();
  if (!url) {
    return { ok: null, skipped: true, detail: "no url" };
  }
  const timeoutSec = Number(opts.timeoutSec) > 0 ? Number(opts.timeoutSec) : 8;
  /** @type {string[]} */
  const args = [
    "-sS",
    "-o",
    "NUL",
    "-w",
    "%{http_code}",
    "--connect-timeout",
    String(timeoutSec),
    "--max-time",
    String(timeoutSec + 2),
  ];
  if (opts.insecure !== false && url.startsWith("https://")) {
    args.push("-k");
  }
  if (opts.hostHeader) {
    args.push("-H", `Host: ${opts.hostHeader}`);
  }
  args.push(url);
  // Windows curl needs NUL; on Unix use /dev/null
  if (platform() !== "win32") {
    const i = args.indexOf("NUL");
    if (i >= 0) args[i] = "/dev/null";
  }
  const started = Date.now();
  const r = spawnSync(curlBin(), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const ms = Date.now() - started;
  const codeRaw = String(r.stdout ?? "").trim();
  const code = /^\d+$/.test(codeRaw) ? Number(codeRaw) : null;
  if ((r.status ?? 1) !== 0 && !code) {
    return {
      ok: false,
      skipped: false,
      http_code: null,
      ms,
      detail: (r.stderr || r.stdout || `curl exit ${r.status}`).trim().slice(0, 240),
    };
  }
  // Accept 401/403 as "up" for apps that require auth; reject 000/5xx gateway
  const up = code !== null && code > 0 && code < 500;
  return {
    ok: up,
    skipped: false,
    http_code: code,
    ms,
    detail: up ? `HTTP ${code}` : `HTTP ${code ?? "000"}`,
  };
}

/**
 * Probe the same path via each WAF LAN IP with Host header.
 * @param {object} opts
 * @param {string[]} opts.wafIps
 * @param {string} opts.hostHeader
 * @param {string} [opts.path]
 * @param {number} [opts.timeoutSec]
 * @returns {LayerResult}
 */
export function probeWafHosts(opts) {
  const ips = (opts.wafIps ?? []).map((x) => String(x).trim()).filter(Boolean);
  const host = String(opts.hostHeader ?? "").trim();
  if (!ips.length || !host) {
    return { ok: null, skipped: true, detail: !ips.length ? "no waf ips" : "no host header" };
  }
  const path = opts.path && opts.path.startsWith("/") ? opts.path : "/";
  /** @type {string[]} */
  const details = [];
  let anyOk = false;
  for (const ip of ips) {
    const r = probeHttp({
      url: `https://${ip}${path}`,
      hostHeader: host,
      timeoutSec: opts.timeoutSec,
      insecure: true,
    });
    details.push(`${ip}:${r.detail ?? r.http_code}`);
    if (r.ok) anyOk = true;
  }
  return {
    ok: anyOk,
    skipped: false,
    detail: details.join("; "),
  };
}
