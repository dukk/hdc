/**
 * Derive overall health status from probe layers.
 * @param {Record<string, { ok?: boolean|null, skipped?: boolean }>} layers
 * @returns {"healthy"|"degraded"|"down"|"unknown"}
 */
export function deriveHealthStatus(layers) {
  const dns = layers.dns;
  const pub = layers.public;
  const waf = layers.waf;
  const direct = layers.direct;
  const guest = layers.guest;
  const api = layers.api;
  const client = layers.client;

  if (api && !api.skipped) {
    if (api.ok === true) return "healthy";
    if (api.ok === false) return "down";
  }
  if (client && !client.skipped) {
    if (client.ok === true) return "healthy";
    if (client.ok === false) return "down";
  }

  const edgeOk = (pub && pub.ok === true) || (waf && waf.ok === true);
  const originOk = (direct && direct.ok === true) || (guest && guest.ok === true);
  const originFail =
    (direct && direct.ok === false && !direct.skipped) ||
    (guest && guest.ok === false && !guest.skipped);
  const edgeFail =
    ((pub && pub.ok === false && !pub.skipped) || (waf && waf.ok === false && !waf.skipped)) &&
    !edgeOk;

  if (edgeOk) return "healthy";
  if (originOk && edgeFail) return "degraded";
  if (originOk && !pub?.skipped && pub?.ok !== true && !waf?.ok) {
    // public skipped or failed DNS, but direct works
    if (dns && dns.ok === false) return "degraded";
    if (direct?.ok === true && (pub?.skipped || waf?.skipped)) return "healthy";
  }
  if (originOk) return "healthy";
  if (originFail) return "down";

  const anyRan = [dns, pub, waf, direct, guest, api, client].some(
    (l) => l && l.skipped === false && l.ok !== null && l.ok !== undefined,
  );
  if (!anyRan) return "unknown";
  return "down";
}

/**
 * @param {"healthy"|"degraded"|"down"|"unknown"} status
 */
export function statusIsOk(status) {
  return status === "healthy" || status === "degraded";
}
