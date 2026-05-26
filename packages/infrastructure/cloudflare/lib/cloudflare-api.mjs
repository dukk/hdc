/** @typedef {{ id: string; name: string; status?: string }} CfZone */

/** @typedef {{ id: string; type: string; name: string; content: string; ttl: number; proxied?: boolean; priority?: number }} CfDnsRecord */

/**
 * @param {unknown} body
 * @returns {string}
 */
function cloudflareErrorMessage(body) {
  if (!body || typeof body !== "object") return "Cloudflare API request failed";
  const b = /** @type {{ errors?: { message?: string; code?: number }[]; messages?: string[] }} */ (body);
  const parts = [];
  if (Array.isArray(b.errors)) {
    for (const e of b.errors) {
      if (e && typeof e.message === "string" && e.message.trim()) {
        parts.push(e.code != null ? `${e.message} (code ${e.code})` : e.message);
      }
    }
  }
  if (!parts.length && Array.isArray(b.messages)) {
    for (const m of b.messages) {
      if (typeof m === "string" && m.trim()) parts.push(m);
    }
  }
  return parts.length ? parts.join("; ") : "Cloudflare API request failed";
}

/**
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} [opts.baseUrl]
 * @param {string | null} [opts.accountId]
 */
export function createCloudflareClient(opts) {
  const baseUrl = (opts.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  const token = opts.token;
  const accountId =
    typeof opts.accountId === "string" && opts.accountId.trim() ? opts.accountId.trim() : null;

  /**
   * @param {string} path
   * @param {{ method?: string; query?: Record<string, string>; body?: unknown }} [req]
   */
  async function request(path, req = {}) {
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url, {
      method: req.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    let body = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Cloudflare API returned non-JSON (${res.status})`);
      }
    }
    if (!res.ok || (body && typeof body === "object" && body.success === false)) {
      throw new Error(cloudflareErrorMessage(body) || `HTTP ${res.status}`);
    }
    return /** @type {{ success?: boolean; result?: unknown; result_info?: { page: number; per_page: number; total_pages: number } }} */ (
      body ?? {}
    );
  }

  /**
   * @param {string} path
   * @param {Record<string, string>} [query]
   */
  async function listAll(path, query = {}) {
    /** @type {unknown[]} */
    const items = [];
    let page = 1;
    for (;;) {
      const res = await request(path, {
        query: { ...query, page: String(page), per_page: "100" },
      });
      const chunk = Array.isArray(res.result) ? res.result : [];
      items.push(...chunk);
      const info = res.result_info;
      if (!info || page >= info.total_pages) break;
      page += 1;
    }
    return items;
  }

  return {
    /**
     * @returns {Promise<CfZone[]>}
     */
    async listZones() {
      const query = accountId ? { "account.id": accountId } : {};
      const raw = await listAll("/zones", query);
      return raw
        .map((z) => {
          const row = /** @type {{ id?: string; name?: string; status?: string }} */ (z);
          return {
            id: String(row.id ?? ""),
            name: String(row.name ?? "").toLowerCase(),
            status: row.status,
          };
        })
        .filter((z) => z.id && z.name);
    },

    /**
     * @param {string} zoneId
     * @returns {Promise<CfDnsRecord[]>}
     */
    async listDnsRecords(zoneId) {
      const raw = await listAll(`/zones/${encodeURIComponent(zoneId)}/dns_records`);
      return raw.map((r) => {
        const row = /** @type {{ id?: string; type?: string; name?: string; content?: string; ttl?: number; proxied?: boolean; priority?: number }} */ (
          r
        );
        return {
          id: String(row.id ?? ""),
          type: String(row.type ?? "").toUpperCase(),
          name: String(row.name ?? ""),
          content: String(row.content ?? ""),
          ttl: typeof row.ttl === "number" ? row.ttl : 1,
          proxied: Boolean(row.proxied),
          priority: typeof row.priority === "number" ? row.priority : undefined,
        };
      });
    },

    /**
     * @param {string} zoneId
     * @param {Record<string, unknown>} body
     */
    async createDnsRecord(zoneId, body) {
      const res = await request(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
        method: "POST",
        body,
      });
      const row = /** @type {{ id?: string }} */ (res.result ?? {});
      return String(row.id ?? "");
    },

    /**
     * @param {string} zoneId
     * @param {string} recordId
     * @param {Record<string, unknown>} body
     */
    async updateDnsRecord(zoneId, recordId, body) {
      await request(
        `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
        { method: "PATCH", body }
      );
    },

    /**
     * @param {string} zoneId
     * @param {string} recordId
     */
    async deleteDnsRecord(zoneId, recordId) {
      await request(
        `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
        { method: "DELETE" }
      );
    },
  };
}
