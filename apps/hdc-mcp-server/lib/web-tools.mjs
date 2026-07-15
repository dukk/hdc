/**
 * Safe web fetch/search helpers for fleet agents (SSRF-hardened).
 */

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 500_000;
const DEFAULT_SEARCH_LIMIT = 5;

/**
 * @param {string} hostname
 */
export function isBlockedHostname(hostname) {
  const h = String(hostname ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal") return true;
  return false;
}

/**
 * @param {string} ip
 */
export function isPrivateOrReservedIp(ip) {
  const s = String(ip ?? "").trim().toLowerCase();
  if (!s) return true;
  if (s === "::1" || s === "0:0:0:0:0:0:0:1") return true;
  if (s.startsWith("fe80:") || s.startsWith("fc") || s.startsWith("fd")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * @param {string} urlString
 * @returns {URL}
 */
export function assertSafePublicHttpUrl(urlString) {
  let u;
  try {
    u = new URL(String(urlString ?? "").trim());
  } catch {
    throw new Error(`invalid URL: ${JSON.stringify(urlString)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`only http/https URLs are allowed (got ${u.protocol})`);
  }
  if (u.username || u.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  if (isBlockedHostname(u.hostname)) {
    throw new Error(`hostname not allowed: ${u.hostname}`);
  }
  if (isPrivateOrReservedIp(u.hostname)) {
    throw new Error(`private/reserved IP not allowed: ${u.hostname}`);
  }
  return u;
}

/**
 * Strip tags to rough plaintext.
 * @param {string} html
 */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} opts
 * @param {string} opts.url
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 */
export async function webFetch(opts) {
  const u = assertSafePublicHttpUrl(opts.url);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(u.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": "hdc-agent-web-tools/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    const finalUrl = String(res.url || u.toString());
    try {
      assertSafePublicHttpUrl(finalUrl);
    } catch (e) {
      throw new Error(`redirect target blocked: ${e instanceof Error ? e.message : String(e)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length > maxBytes;
    const slice = truncated ? buf.subarray(0, maxBytes) : buf;
    const ct = String(res.headers?.get?.("content-type") ?? "");
    const raw = slice.toString("utf8");
    const text = /html/i.test(ct) || /^\s*</.test(raw) ? htmlToText(raw) : raw.trim();
    return {
      ok: res.ok,
      status: res.status,
      url: finalUrl,
      content_type: ct,
      truncated,
      text: text.slice(0, maxBytes),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse DuckDuckGo HTML lite result rows.
 * @param {string} html
 * @param {number} limit
 */
export function parseDuckDuckGoHtmlResults(html, limit = DEFAULT_SEARCH_LIMIT) {
  /** @type {{ title: string, url: string, snippet: string }[]} */
  const out = [];
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>)?/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    let href = m[1];
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname === "/l/") {
        const uddg = parsed.searchParams.get("uddg");
        if (uddg) href = decodeURIComponent(uddg);
      } else {
        href = parsed.toString();
      }
    } catch {
      continue;
    }
    try {
      assertSafePublicHttpUrl(href);
    } catch {
      continue;
    }
    out.push({
      title: htmlToText(m[2]).slice(0, 200),
      url: href,
      snippet: htmlToText(m[3] ?? "").slice(0, 400),
    });
  }
  return out;
}

/**
 * DuckDuckGo HTML search (no API key). Optional `HDC_WEB_SEARCH_API_KEY` reserved for future backends.
 * @param {object} opts
 * @param {string} opts.query
 * @param {number} [opts.limit]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.apiKey]
 */
export async function webSearch(opts) {
  const query = String(opts.query ?? "").trim();
  if (!query) throw new Error("query is required");
  if (query.length > 300) throw new Error("query too long (max 300 chars)");
  const limit = Math.min(Math.max(Number(opts.limit) || DEFAULT_SEARCH_LIMIT, 1), 10);
  void opts.apiKey;

  const u = assertSafePublicHttpUrl(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  );
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(u.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": "hdc-agent-web-tools/1.0",
        Accept: "text/html",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.subarray(0, 800_000).toString("utf8");
    return {
      ok: res.ok,
      query,
      provider: "duckduckgo-html",
      results: parseDuckDuckGoHtmlResults(html, limit),
    };
  } finally {
    clearTimeout(timer);
  }
}
