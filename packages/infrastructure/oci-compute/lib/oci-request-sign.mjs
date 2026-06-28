import { createHash, createSign } from "node:crypto";

/**
 * @typedef {object} OciCredentials
 * @property {string} tenancyOcid
 * @property {string} userOcid
 * @property {string} fingerprint
 * @property {string} privateKeyPem
 */

/**
 * @typedef {object} OciSignRequest
 * @property {string} method
 * @property {string} host
 * @property {string} path
 * @property {Record<string, string>} [headers]
 * @property {string | undefined} [body]
 * @property {Date} [now]
 */

const REQUIRED_HEADERS = ["(request-target)", "host", "date"];

/**
 * @param {string} body
 */
export function sha256Base64(body) {
  return createHash("sha256").update(body, "utf8").digest("base64");
}

/**
 * @param {OciCredentials} creds
 * @param {OciSignRequest} req
 * @returns {Record<string, string>}
 */
export function signOciRequest(creds, req) {
  const method = req.method.toLowerCase();
  const now = req.now ?? new Date();
  const date = now.toUTCString();
  const body = req.body ?? "";

  /** @type {Record<string, string>} */
  const headers = {
    host: req.host,
    date,
    ...(req.headers ?? {}),
  };

  if (body) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    headers["content-length"] = String(Buffer.byteLength(body, "utf8"));
    headers["x-content-sha256"] = sha256Base64(body);
  }

  const signingHeaders = body
    ? ["(request-target)", "host", "date", "x-content-sha256", "content-type", "content-length"]
    : REQUIRED_HEADERS;

  const signingString = signingHeaders
    .map((name) => {
      if (name === "(request-target)") return `(request-target): ${method} ${req.path}`;
      return `${name}: ${headers[name]}`;
    })
    .join("\n");

  const sign = createSign("RSA-SHA256");
  sign.update(signingString);
  sign.end();
  const signature = sign.sign(creds.privateKeyPem).toString("base64");

  const keyId = `${creds.tenancyOcid}/${creds.userOcid}/${creds.fingerprint}`;
  headers.authorization = `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${signingHeaders.join(" ")}",signature="${signature}"`;

  return headers;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizePrivateKeyPem(raw) {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN")) return trimmed;
  const lines = trimmed.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}
