import { createHash, createHmac } from "node:crypto";

/**
 * @typedef {object} AwsCredentials
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {string} [sessionToken]
 */

/**
 * @typedef {object} AwsSignedRequestInit
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} [headers]
 * @property {string | Uint8Array | undefined} [body]
 * @property {AwsCredentials} credentials
 * @property {string} region
 * @property {string} service
 * @property {Date} [now]
 */

const HEX = "0123456789abcdef";

/**
 * @param {Uint8Array} bytes
 */
function toHex(bytes) {
  let out = "";
  for (const b of bytes) {
    out += HEX[b >> 4] + HEX[b & 0x0f];
  }
  return out;
}

/**
 * @param {string} data
 */
function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * @param {Uint8Array} key
 * @param {string} data
 */
function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * @param {string} key
 * @param {string} dateStamp
 * @param {string} region
 * @param {string} service
 */
function deriveSigningKey(key, dateStamp, region, service) {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * URI-encode per AWS SigV4 rules (except unreserved set).
 * @param {string} value
 * @param {boolean} encodeSlash
 */
export function awsUriEncode(value, encodeSlash = true) {
  /** @type {string[]} */
  const parts = [];
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const unreserved =
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x30 && code <= 0x39) ||
      ch === "_" ||
      ch === "-" ||
      ch === "~" ||
      ch === ".";
    if (unreserved || (!encodeSlash && ch === "/")) {
      parts.push(ch);
    } else {
      const encoded = encodeURIComponent(ch);
      parts.push(encoded.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));
    }
  }
  return parts.join("");
}

/**
 * @param {URL} url
 */
function canonicalQueryString(url) {
  const pairs = [];
  url.searchParams.forEach((value, key) => {
    pairs.push([awsUriEncode(key), awsUriEncode(value)]);
  });
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * @param {Record<string, string>} headers
 */
function canonicalHeaders(headers) {
  const lowered = Object.entries(headers).map(([k, v]) => [k.toLowerCase().trim(), v.trim().replace(/\s+/g, " ")]);
  lowered.sort((a, b) => a[0].localeCompare(b[0]));
  const names = lowered.map(([k]) => k).join(";");
  const values = lowered.map(([, v]) => `${v}\n`).join("");
  return { canonical: values, signedHeaders: names };
}

/**
 * Build Authorization header and signed headers for an AWS API request.
 * @param {AwsSignedRequestInit} init
 * @returns {{ headers: Record<string, string>; authorization: string }}
 */
export function signAwsRequest(init) {
  const url = new URL(init.url);
  const now = init.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const body =
    init.body === undefined
      ? ""
      : typeof init.body === "string"
        ? init.body
        : Buffer.from(init.body).toString("utf8");
  const payloadHash = sha256Hex(body);

  /** @type {Record<string, string>} */
  const headers = { ...(init.headers ?? {}) };
  if (!headers.host) headers.host = url.host;
  headers["x-amz-date"] = amzDate;
  if (init.credentials.sessionToken) {
    headers["x-amz-security-token"] = init.credentials.sessionToken;
  }
  if (init.method.toUpperCase() === "POST" && !headers["content-type"]) {
    headers["content-type"] = "application/x-www-form-urlencoded; charset=utf-8";
  }
  if (!headers["x-amz-content-sha256"]) {
    headers["x-amz-content-sha256"] = payloadHash;
  }

  const { canonical: canonicalHeadersStr, signedHeaders } = canonicalHeaders(headers);
  const canonicalRequest = [
    init.method.toUpperCase(),
    awsUriEncode(url.pathname, false) || "/",
    canonicalQueryString(url),
    canonicalHeadersStr,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${init.region}/${init.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(
    init.credentials.secretAccessKey,
    dateStamp,
    init.region,
    init.service,
  );
  const signature = toHex(hmac(signingKey, stringToSign));

  const authorization = [
    "AWS4-HMAC-SHA256",
    `Credential=${init.credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    headers: { ...headers, authorization },
    authorization,
  };
}

/**
 * Signed fetch wrapper for AWS JSON/query APIs.
 * @param {AwsSignedRequestInit} init
 * @param {typeof fetch} [fetchImpl]
 */
export async function awsSignedFetch(init, fetchImpl = fetch) {
  const { headers } = signAwsRequest(init);
  const body =
    init.body === undefined
      ? undefined
      : typeof init.body === "string"
        ? init.body
        : Buffer.from(init.body);
  const res = await fetchImpl(init.url, {
    method: init.method,
    headers,
    body,
  });
  return res;
}
