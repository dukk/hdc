/**
 * Query Proxmox VE nodes from manual inventory (tag `proxmox` or automation target `proxmox`),
 * then write automated system sidecars for each hypervisor and for VMs/LXC it hosts.
 *
 * Auth: Proxmox API token (see Datacenter → Permissions → API Tokens). Stored in the vault
 * as HDC_PROXMOX_API_TOKEN or per-host HDC_PROXMOX_API_TOKEN_<HOST_ID> (e.g. HDC_PROXMOX_API_TOKEN_PVE_A).
 * Env override: HDC_PROXMOX_API_TOKEN. Self-signed TLS: HDC_PROXMOX_TLS_INSECURE=1 or HDC_TLS_INSECURE=1 (global default).
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stderr as errout, env } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

import {
  automatedInventoryIdFromName,
  findInventorySidecars,
  mergeAutomatedSidecarFromTarget,
  mergeAutomatedSystemsFromPlugin,
  pruneAutomatedSidecarSourceForTarget,
} from "../../../tools/hdc/inventory.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../../tools/hdc/lib/vault-access.mjs";
import { readLineMasked } from "../../../tools/hdc/lib/readline-masked.mjs";
import {
  HDC_TLS_INSECURE_ENV,
  hdcTlsInsecureSourceEnv,
  hdcTlsRejectUnauthorized,
} from "../../../tools/hdc/lib/tls-insecure-env.mjs";
import { defaultVaultPath } from "../../../tools/hdc/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const repoRoot = join(here, "..", "..", "..");

const VAULT_KEY_GLOBAL = "HDC_PROXMOX_API_TOKEN";
const SPEC_TLS_INSECURE = "HDC_PROXMOX_TLS_INSECURE";

/** @param {string} line */
function logUser(line) {
  errout.write(`[proxmox] ${line}\n`);
}

/** @param {string} root @param {string} abs */
function relFromRoot(root, abs) {
  try {
    return relative(root, abs).replace(/\\/g, "/");
  } catch {
    return abs;
  }
}

/**
 * @param {string} hostInventoryId e.g. pve-a
 */
function vaultTokenKeyForHost(hostInventoryId) {
  return `HDC_PROXMOX_API_TOKEN_${hostInventoryId.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * @param {string} raw
 */
function normalizePveAuthorization(raw) {
  const t = raw.trim();
  if (!t) return t;
  if (/^PVEAPIToken=/i.test(t)) return t;
  return `PVEAPIToken=${t}`;
}

/**
 * @param {string} webUiOrBase
 */
function apiBaseFromWebUi(webUiOrBase) {
  const s = webUiOrBase.trim();
  const withProto = /:\/\//.test(s) ? s : `https://${s}`;
  const u = new URL(withProto);
  const port = u.port || (u.protocol === "https:" ? "8006" : "80");
  return `${u.protocol}//${u.hostname}:${port}`;
}

/**
 * @param {unknown} row
 * @returns {row is Record<string, unknown>}
 */
function isObject(row) {
  return row !== null && typeof row === "object" && !Array.isArray(row);
}

/**
 * @param {string} baseUrl
 * @param {string} path e.g. /version (no /api2/json prefix)
 * @param {string} authorization full Authorization header value
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<unknown>}
 */
function pveJsonGet(baseUrl, path, authorization, rejectUnauthorized) {
  const root = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${root}/api2/json${p}`;
  const agent = new https.Agent({ rejectUnauthorized });
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent,
        headers: {
          Accept: "application/json",
          Authorization: authorization,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          /** @type {unknown} */
          let parsed;
          try {
            parsed = raw.length ? JSON.parse(raw) : null;
          } catch (e) {
            reject(new Error(`Invalid JSON from Proxmox (${res.statusCode}): ${String(e)}`));
            return;
          }
          const code = res.statusCode ?? 0;
          if (code < 200 || code >= 300) {
            const err = new Error(`Proxmox HTTP ${code} ${p}`);
            reject(err);
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * @param {unknown} body
 * @returns {unknown[]}
 */
function pveDataArray(body) {
  if (!isObject(body)) return [];
  const d = body.data;
  return Array.isArray(d) ? d : [];
}

/**
 * @param {Record<string, unknown>} sidecar
 * @returns {{ id: string; path: string; rel: string; apiBase: string; pveNode: string; clusterId: string | null } | null}
 */
function proxmoxHostFromManualSidecar(sidecar, path) {
  if (!isObject(sidecar) || sidecar.kind !== "system") return null;
  const id = typeof sidecar.id === "string" ? sidecar.id.trim() : "";
  if (!id) return null;

  const tags = Array.isArray(sidecar.tags) ? sidecar.tags.map((t) => String(t)) : [];
  const targets = Array.isArray(sidecar.automation_targets) ? sidecar.automation_targets.map(String) : [];
  const tagHit = tags.some((t) => t.toLowerCase() === "proxmox");
  const targetHit = targets.includes(target);
  if (!tagHit && !targetHit) return null;

  const access = sidecar.access;
  if (!isObject(access)) return null;
  const nodes = access.nodes;
  if (!Array.isArray(nodes) || !nodes.length) {
    logUser(`skip ${JSON.stringify(id)} (no access.nodes)`);
    return null;
  }
  const n0 = nodes[0];
  if (!isObject(n0)) return null;
  const webUi = typeof n0.web_ui === "string" ? n0.web_ui.trim() : "";
  const ip = typeof n0.ip === "string" ? n0.ip.trim() : "";
  const basis = webUi || (ip ? `https://${ip}:8006` : "");
  if (!basis) {
    logUser(`skip ${JSON.stringify(id)} (no web_ui or ip for API base)`);
    return null;
  }
  const pveNode =
    (typeof n0.name === "string" && n0.name.trim()) ||
    (typeof n0.hostname === "string" && n0.hostname.trim()) ||
    id;

  let clusterId = null;
  const pc = sidecar.proxmox_cluster;
  if (isObject(pc) && typeof pc.id === "string" && pc.id.trim()) clusterId = pc.id.trim();

  return {
    id,
    path,
    rel: relFromRoot(repoRoot, path),
    apiBase: apiBaseFromWebUi(basis),
    pveNode: String(pveNode).trim(),
    clusterId,
  };
}

/**
 * @returns {Map<string, { id: string; path: string; rel: string; apiBase: string; pveNode: string; clusterId: string | null }[]>}
 */
function loadProxmoxHostsByCluster() {
  /** @type {Map<string, { id: string; path: string; rel: string; apiBase: string; pveNode: string; clusterId: string | null }[]>} */
  const byCluster = new Map();
  for (const p of findInventorySidecars(repoRoot)) {
    const norm = p.replace(/\\/g, "/");
    if (!norm.includes("/inventory/manual/systems/")) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    const host = proxmoxHostFromManualSidecar(data, p);
    if (!host) continue;
    const key = host.clusterId ?? `__standalone__:${host.id}`;
    const arr = byCluster.get(key) ?? [];
    arr.push(host);
    byCluster.set(key, arr);
  }
  for (const [, members] of byCluster) {
    members.sort((a, b) => a.id.localeCompare(b.id));
  }
  return byCluster;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function byVmid(a, b) {
  const va = isObject(a) && typeof a.vmid === "number" ? a.vmid : 0;
  const vb = isObject(b) && typeof b.vmid === "number" ? b.vmid : 0;
  return va - vb;
}

async function main() {
  const t0 = Date.now();
  const rejectUnauthorized = hdcTlsRejectUnauthorized(env, SPEC_TLS_INSECURE);
  const tlsInsecureVia = hdcTlsInsecureSourceEnv(env, SPEC_TLS_INSECURE);

  logUser(`query starting — target ${JSON.stringify(target)}`);
  logUser(`repo root: ${repoRoot.replace(/\\/g, "/")}`);
  logUser(
    rejectUnauthorized
      ? `TLS certificate verification is ON (set ${SPEC_TLS_INSECURE}=1 or ${HDC_TLS_INSECURE_ENV}=1 for self-signed node certs).`
      : `TLS certificate verification is OFF (${tlsInsecureVia}=1).`,
  );

  const vault = createVaultAccess(
    vaultDepsFromCli({
      env,
      log: (...a) => errout.write(`${a.join(" ")}\n`),
      error: (...a) => errout.write(`${a.join(" ")}\n`),
      warn: (...a) => errout.write(`${a.join(" ")}\n`),
      defaultVaultPath,
      existsSync,
      readLineQuestion: async (q, opts) => {
        if (opts?.mask) {
          return readLineMasked(q, errout, input);
        }
        const rl = createInterface({ input, output: errout });
        try {
          return await rl.question(q);
        } finally {
          rl.close();
        }
      },
    }),
  );

  const byCluster = loadProxmoxHostsByCluster();
  const clusterKeys = [...byCluster.keys()].sort();
  if (!clusterKeys.length) {
    errout.write(
      `[proxmox] No Proxmox hypervisors found in manual inventory (tag "proxmox" or automation_targets includes ${JSON.stringify(target)}, with access.nodes[].web_ui or ip).\n`,
    );
    process.exitCode = 1;
    return;
  }

  logUser(
    `Found ${clusterKeys.length} cluster/standalone group(s) from inventory: ${clusterKeys.map((k) => JSON.stringify(k)).join(", ")}`,
  );

  const collectedAt = new Date().toISOString();

  /** @type {Record<string, unknown>[]} */
  const mergedRecords = [];
  /** @type {string[]} */
  const activeIds = [];

  /** @type {Set<string>} */
  const guestIdUsed = new Set();

  let hypervisorCount = 0;
  let guestCount = 0;

  for (const ck of clusterKeys) {
    const members = byCluster.get(ck);
    if (!members?.length) continue;
    const lead = members[0];
    logUser(
      `Cluster ${JSON.stringify(ck)}: using API endpoint from inventory id ${JSON.stringify(lead.id)} (${lead.rel}) → ${lead.apiBase}`,
    );

    const verify = async (/** @type {string} */ token) => {
      try {
        const auth = normalizePveAuthorization(token);
        logUser(`Verifying API token with GET /version on ${lead.apiBase} …`);
        await pveJsonGet(lead.apiBase, "/version", auth, rejectUnauthorized);
        logUser("Proxmox API OK (version endpoint).");
        return true;
      } catch (e) {
        errout.write(
          `[proxmox] Token verification failed (${/** @type {Error} */ (e).message}). Check token, URL, and TLS (${SPEC_TLS_INSECURE}=1 or ${HDC_TLS_INSECURE_ENV}=1 if needed).\n`,
        );
        return false;
      }
    };

    /** @type {string | null} */
    let authorization = null;
    const envTok = String(env.HDC_PROXMOX_API_TOKEN ?? "").trim();
    if (envTok) {
      logUser("Checking HDC_PROXMOX_API_TOKEN from environment …");
      const auth = normalizePveAuthorization(envTok);
      if (await verify(auth)) authorization = auth;
      else logUser("Environment token failed verification; will try vault / prompt.");
    }

    if (!authorization) {
      const data = (await vault.readSecrets({})) ?? {};
      const perKey = vaultTokenKeyForHost(lead.id);
      const perVal = typeof data[perKey] === "string" ? data[perKey].trim() : "";
      const globVal = typeof data[VAULT_KEY_GLOBAL] === "string" ? data[VAULT_KEY_GLOBAL].trim() : "";
      if (perVal) {
        logUser(`Trying vault key ${perKey} (per-host) …`);
        const auth = normalizePveAuthorization(perVal);
        if (await verify(auth)) authorization = auth;
      }
      if (!authorization && globVal) {
        logUser(`Trying vault key ${VAULT_KEY_GLOBAL} …`);
        const auth = normalizePveAuthorization(globVal);
        if (await verify(auth)) authorization = auth;
      }
    }

    if (!authorization) {
      logUser(`No working token yet; vault getSecret ${VAULT_KEY_GLOBAL} (passphrase may be prompted) …`);
      const token = await vault.getSecret(VAULT_KEY_GLOBAL, {
        promptLabel:
          "Proxmox API token (full value: user@realm!tokenid=secret, or prefix with PVEAPIToken=)",
        verify: async (v) => verify(v),
      });
      authorization = normalizePveAuthorization(token);
    }

    if (!authorization) {
      errout.write(`[proxmox] No working API token for cluster group ${JSON.stringify(ck)}.\n`);
      process.exitCode = 1;
      return;
    }

    /** @type {Map<string, string>} */
    const pveNodeToInventory = new Map();
    for (const m of members) pveNodeToInventory.set(m.pveNode, m.id);

    logUser(`GET /cluster/resources?type=vm … (${lead.apiBase})`);
    const resourcesBody = await pveJsonGet(
      lead.apiBase,
      "/cluster/resources?type=vm",
      authorization,
      rejectUnauthorized,
    );
    const resourceRows = pveDataArray(resourcesBody).filter(isObject).sort(byVmid);
    const guests = resourceRows.filter((r) => {
      const typ = typeof r.type === "string" ? r.type : "";
      if (typ !== "qemu" && typ !== "lxc") return false;
      if (r.template === 1) return false;
      return true;
    });
    logUser(`Guests (qemu/lxc, non-template): ${guests.length} in group ${JSON.stringify(ck)}.`);

    /** @type {unknown} */
    let clusterVersion = null;
    try {
      clusterVersion = await pveJsonGet(lead.apiBase, "/version", authorization, rejectUnauthorized);
    } catch (e) {
      errout.write(
        `[proxmox] GET /version failed for cluster group ${JSON.stringify(ck)} (${/** @type {Error} */ (e).message}).\n`,
      );
    }

    for (const m of members) {
      logUser(`GET /nodes/${encodeURIComponent(m.pveNode)}/status for inventory ${JSON.stringify(m.id)} …`);
      let status = null;
      try {
        status = await pveJsonGet(
          lead.apiBase,
          `/nodes/${encodeURIComponent(m.pveNode)}/status`,
          authorization,
          rejectUnauthorized,
        );
      } catch (e) {
        errout.write(
          `[proxmox] Node status failed for ${m.pveNode} (${/** @type {Error} */ (e).message}).\n`,
        );
      }

      const manual = JSON.parse(readFileSync(m.path, "utf8"));
      const manualPc = isObject(manual) ? manual.proxmox_cluster : null;

      /** @type {Record<string, unknown>} */
      const hostQuery = {
        collected_at: collectedAt,
        inventory_path: m.rel,
        api_base_used: lead.apiBase,
        pve_node: m.pveNode,
        cluster_inventory_key: ck,
        version:
          clusterVersion && isObject(clusterVersion) ? clusterVersion.data ?? clusterVersion : clusterVersion,
        node_status: status && isObject(status) ? status.data ?? status : status,
      };

      /** @type {Record<string, unknown>} */
      const hostRecord = {
        kind: "system",
        id: m.id,
        system_class: "physical",
        tags: ["proxmox", "automated"],
        query_last: hostQuery,
      };
      if (isObject(manualPc)) hostRecord.proxmox_cluster = manualPc;

      mergedRecords.push(hostRecord);
      activeIds.push(m.id);
      hypervisorCount += 1;
    }

    for (const r of guests) {
      const node = typeof r.node === "string" ? r.node.trim() : "";
      const mappedHost = node ? pveNodeToInventory.get(node) : "";
      if (node && !mappedHost) {
        logUser(
          `WARN: guest vmid ${typeof r.vmid === "number" ? r.vmid : "?"} is on PVE node ${JSON.stringify(node)}, which has no matching inventory hypervisor in this group — hosted_on_system_id omitted.`,
        );
      }
      const typ = typeof r.type === "string" ? r.type : "qemu";
      const prefix = typ === "lxc" ? "ct" : "vm";
      const name =
        (typeof r.name === "string" && r.name.trim()) ||
        (typeof r.vmid === "number" ? `id-${r.vmid}` : "unknown");
      const guestId = automatedInventoryIdFromName(prefix, { name, id: String(r.vmid ?? "") }, guestIdUsed);

      /** @type {Record<string, unknown>} */
      const vh = { ...r };

      /** @type {Record<string, unknown>} */
      const guestRecord = {
        kind: "system",
        id: guestId,
        system_class: "virtual",
        tags: ["proxmox", "automated"],
        hosted_on_system_id: mappedHost || undefined,
        virtual_hardware: vh,
        query_last: { ...r, collected_at: collectedAt, pve_node: node },
      };

      const firstMember = members[0];
      const manualForCluster = JSON.parse(readFileSync(firstMember.path, "utf8"));
      const pc = isObject(manualForCluster) ? manualForCluster.proxmox_cluster : null;
      if (isObject(pc)) guestRecord.proxmox_cluster = pc;

      mergedRecords.push(guestRecord);
      activeIds.push(guestId);
      guestCount += 1;
    }
  }

  logUser(`Writing ${mergedRecords.length} automated system sidecar(s) under inventory/automated/systems/ …`);
  for (const rec of mergedRecords) {
    mergeAutomatedSidecarFromTarget(repoRoot, rec, target);
  }

  pruneAutomatedSidecarSourceForTarget(repoRoot, ["systems"], target, activeIds);
  logUser(`Prune list: ${activeIds.length} active id(s) for target ${JSON.stringify(target)}.`);

  const payload = {
    target,
    verb: "query",
    ok: true,
    collected_at: collectedAt,
    hypervisor_count: hypervisorCount,
    guest_count: guestCount,
    cluster_group_count: clusterKeys.length,
    systems: [],
    message:
      "Proxmox snapshot merged into inventory/automated/systems/ via sources[proxmox]; plugin metadata in inventory/manual/targets/proxmox.json.",
  };

  mergeAutomatedSystemsFromPlugin(repoRoot, target, "query", payload);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  logUser(`Finished in ${elapsed}s. JSON summary on stdout for hdc.`);

  errout.write(`\n[proxmox] — Summary —\n`);
  errout.write(
    `Hypervisors: ${hypervisorCount} · Guests (vm/ct): ${guestCount} · Cluster groups: ${clusterKeys.length}\n`,
  );

  output.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((e) => {
  errout.write(`[proxmox] Fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.exitCode = 1;
});
