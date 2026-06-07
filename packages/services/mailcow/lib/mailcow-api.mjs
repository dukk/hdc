import { loadMailRelayClientDefaults } from "../../../lib/mail-relay-config.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @typedef {object} MailcowApiClient
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {(path: string, opts?: { method?: string; body?: unknown }) => Promise<unknown>} request
 */

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @returns {MailcowApiClient}
 */
export function createMailcowApiClient(baseUrl, apiKey) {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    baseUrl: root,
    apiKey,
    request: (path, opts = {}) => mailcowRequest(root, apiKey, path, opts),
  };
}

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
 */
export async function mailcowRequest(baseUrl, apiKey, path, opts = {}) {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  /** @type {RequestInit} */
  const init = {
    method,
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
  };
  if (opts.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new Error(`mailcow API ${method} ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return data;
}

/**
 * @param {unknown} response
 */
function apiSuccess(response) {
  if (Array.isArray(response)) {
    const first = response[0];
    if (isObject(first) && first.type === "danger") return false;
    if (isObject(first) && first.type === "error") return false;
    return true;
  }
  return true;
}

/**
 * @param {MailcowApiClient} client
 */
export async function listDomains(client) {
  const data = await client.request("/api/v1/get/domain/all");
  if (!Array.isArray(data)) return [];
  return data.filter(isObject);
}

/**
 * @param {MailcowApiClient} client
 * @param {string} domain
 */
export async function getDkim(client, domain) {
  const data = await client.request(`/api/v1/get/dkim/${encodeURIComponent(domain)}`);
  return isObject(data) ? data : null;
}

/**
 * @param {MailcowApiClient} client
 * @param {string} domain
 * @param {string} selector
 * @param {1024 | 2048} keySize
 */
export async function generateDkim(client, domain, selector, keySize) {
  return client.request("/api/v1/add/dkim", {
    method: "POST",
    body: {
      domains: domain,
      dkim_selector: selector,
      key_size: String(keySize),
    },
  });
}

/**
 * @param {MailcowApiClient} client
 * @param {string} domain
 * @param {Record<string, unknown>} [attrs]
 */
export async function addDomain(client, domain, attrs = {}) {
  const body = {
    active: "1",
    aliases: "400",
    backupmx: "0",
    defquota: "3072",
    description: typeof attrs.description === "string" ? attrs.description : "",
    domain,
    mailboxes: "10",
    maxquota: "10240",
    quota: "10240",
    relay_all_recipients: "0",
    rl_frame: "s",
    rl_value: "10",
    restart_sogo: "1",
    ...attrs,
  };
  const res = await client.request("/api/v1/add/domain", { method: "POST", body });
  if (!apiSuccess(res)) {
    throw new Error(`add domain ${domain} failed`);
  }
  return res;
}

/**
 * @param {MailcowApiClient} client
 * @param {string} domain
 * @param {Record<string, unknown>} attr
 */
export async function editDomain(client, domain, attr) {
  const res = await client.request("/api/v1/edit/domain", {
    method: "POST",
    body: { items: [domain], attr },
  });
  if (!apiSuccess(res)) {
    throw new Error(`edit domain ${domain} failed`);
  }
  return res;
}

/**
 * @param {MailcowApiClient} client
 */
export async function listRelayhosts(client) {
  const data = await client.request("/api/v1/get/relayhost/all");
  if (!Array.isArray(data)) return [];
  return data.filter(isObject);
}

/**
 * @param {MailcowApiClient} client
 * @param {string} hostname host:port
 */
export async function addRelayhost(client, hostname) {
  const res = await client.request("/api/v1/add/relayhost", {
    method: "POST",
    body: { hostname, username: "", password: "" },
  });
  if (!apiSuccess(res)) {
    throw new Error(`add relayhost ${hostname} failed`);
  }
  return res;
}

/**
 * @param {MailcowApiClient} client
 * @param {string} hostname
 */
export async function ensureRelayhostId(client, hostname) {
  const hosts = await listRelayhosts(client);
  const want = hostname.trim().toLowerCase();
  for (const h of hosts) {
    const hn = typeof h.hostname === "string" ? h.hostname.trim().toLowerCase() : "";
    if (hn === want) {
      const id = h.id;
      return id !== undefined && id !== null ? String(id) : null;
    }
  }
  await addRelayhost(client, hostname);
  const after = await listRelayhosts(client);
  for (const h of after) {
    const hn = typeof h.hostname === "string" ? h.hostname.trim().toLowerCase() : "";
    if (hn === want) {
      const id = h.id;
      return id !== undefined && id !== null ? String(id) : null;
    }
  }
  return null;
}

/**
 * @param {import("./mailcow-dns.mjs").MailcowDomainConfig[]} domains
 * @param {MailcowApiClient} client
 */
export async function reconcileMailcowDomains(domains, client) {
  const relayDefaults = loadMailRelayClientDefaults();
  const relayHostname = `${relayDefaults.relay_hostname}:${relayDefaults.relay_port}`;

  const existing = await listDomains(client);
  const byName = new Map(
    existing.map((d) => [
      typeof d.domain_name === "string" ? d.domain_name.trim() : "",
      d,
    ]),
  );

  /** @type {string | null} */
  let relayIdCache = null;

  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const domain of domains) {
    /** @type {Record<string, unknown>} */
    const row = {
      domain: domain.name,
      outbound_mode: domain.outbound_mode,
      domain_added: false,
      dkim_generated: false,
      relayhost_id: null,
      ok: true,
      message: "ok",
    };

    try {
      if (!byName.has(domain.name)) {
        await addDomain(client, domain.name, {
          description: domain.description || `hdc mailcow ${domain.name}`,
        });
        row.domain_added = true;
        byName.set(domain.name, { domain_name: domain.name });
      }

      let dkim = await getDkim(client, domain.name);
      const dkimTxt = isObject(dkim) && typeof dkim.dkim_txt === "string" ? dkim.dkim_txt.trim() : "";
      if (!dkimTxt) {
        await generateDkim(client, domain.name, domain.dkim_selector, domain.dkim_key_size);
        row.dkim_generated = true;
        dkim = await getDkim(client, domain.name);
      }
      row.dkim_selector =
        isObject(dkim) && typeof dkim.dkim_selector === "string" ? dkim.dkim_selector : domain.dkim_selector;
      row.dkim_txt =
        isObject(dkim) && typeof dkim.dkim_txt === "string" ? dkim.dkim_txt : null;

      if (domain.outbound_mode === "postfix-relay") {
        if (!relayIdCache) {
          relayIdCache = await ensureRelayhostId(client, relayHostname);
        }
        if (!relayIdCache) {
          throw new Error(`failed to ensure relayhost ${relayHostname}`);
        }
        await editDomain(client, domain.name, { relayhost: relayIdCache });
        row.relayhost_id = relayIdCache;
      } else {
        await editDomain(client, domain.name, { relayhost: "0" });
        row.relayhost_id = "0";
      }
    } catch (e) {
      row.ok = false;
      row.message = String(/** @type {Error} */ (e).message || e);
    }

    results.push(row);
  }

  return results;
}
