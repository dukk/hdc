import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { automationDir, inventoryAutomatedSystemsPath, inventoryManualDir } from "./paths.mjs";

const KINDS = new Set(["system", "network", "target", "services"]);

const MARKER_START = "<!-- hdc:inventory -->";
const MARKER_END = "<!-- /hdc:inventory -->";

const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;

/** @param {string} root */
export function findInventorySidecars(root) {
  const base = inventoryManualDir(root);
  if (!existsSync(base)) return [];
  /** @type {string[]} */
  const files = [];
  for (const sub of readdirSync(base, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const dir = join(base, sub.name);
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (ent.name.endsWith(".inventory.json")) {
        files.push(join(dir, ent.name));
      }
    }
  }
  return files.sort();
}

/** @param {string} sidecarPath */
export function companionMarkdownPath(sidecarPath) {
  if (!sidecarPath.endsWith(".inventory.json")) return null;
  return sidecarPath.slice(0, -".inventory.json".length) + ".md";
}

/** @param {Record<string, unknown>} o */
function accessNodeNames(o) {
  const access = o.access;
  if (!access || typeof access !== "object" || access === null || Array.isArray(access)) {
    return new Set();
  }
  const nodes = /** @type {Record<string, unknown>} */ (access).nodes;
  if (!Array.isArray(nodes)) return new Set();
  /** @type {Set<string>} */
  const names = new Set();
  for (const n of nodes) {
    if (!n || typeof n !== "object" || Array.isArray(n)) continue;
    const nm = /** @type {Record<string, unknown>} */ (n).name;
    if (typeof nm === "string" && nm.trim()) names.add(nm.trim());
  }
  return names;
}

/**
 * Build id → kind for all manual inventory sidecars (for cross-file refs).
 * @param {string} root
 * @param {(path: string) => string} readUtf8 read file as UTF-8 string (e.g. p => readFileSync(p, "utf8"))
 * @returns {{ idToKind: Map<string, string>, duplicateIds: string[] }}
 */
export function loadManualInventoryIdKindMap(root, readUtf8) {
  /** @type {Map<string, string>} */
  const idToKind = new Map();
  /** @type {Map<string, number>} */
  const idCount = new Map();
  for (const p of findInventorySidecars(root)) {
    let data;
    try {
      data = JSON.parse(readUtf8(p));
    } catch {
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const id = typeof data.id === "string" ? data.id.trim() : "";
    const kind = typeof data.kind === "string" ? data.kind.trim() : "";
    if (!id) continue;
    idToKind.set(id, kind);
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }
  /** @type {string[]} */
  const duplicateIds = [];
  for (const [id, n] of idCount) {
    if (n > 1) duplicateIds.push(id);
  }
  return { idToKind, duplicateIds };
}

/**
 * @param {unknown} data
 * @param {Set<string>} automationIds
 * @param {{ idToKind?: Map<string, string> } | undefined} [refContext] when validating system.services refs
 * @returns {string[]} errors
 */
export function validateSidecar(data, automationIds, refContext) {
  /** @type {string[]} */
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push("root must be a JSON object");
    return errors;
  }
  const o = /** @type {Record<string, unknown>} */ (data);
  if (o.schema_version !== 1) {
    errors.push(`schema_version must be 1, got ${JSON.stringify(o.schema_version)}`);
  }
  if (typeof o.id !== "string" || !o.id.trim()) {
    errors.push("id must be a non-empty string");
  }
  if (typeof o.kind !== "string" || !KINDS.has(o.kind)) {
    errors.push(`kind must be one of: ${[...KINDS].join(", ")}`);
  }
  if (o.access !== undefined && (typeof o.access !== "object" || o.access === null || Array.isArray(o.access))) {
    errors.push("access must be an object if present");
  }
  if (o.auth !== undefined) {
    const ae = validateAuthRefs(o.auth, "auth");
    errors.push(...ae);
  }
  if (o.tags !== undefined) {
    if (!Array.isArray(o.tags) || !o.tags.every((t) => typeof t === "string")) {
      errors.push("tags must be an array of strings if present");
    }
  }
  if (o.kind === "target") {
    const at = o.automation_target;
    if (typeof at !== "string" || !at.trim()) {
      errors.push("kind target requires non-empty string automation_target");
    } else if (!automationIds.has(at.trim())) {
      errors.push(`automation_target: unknown target ${JSON.stringify(at)}`);
    }
  }
  if (o.kind !== "target" && o.automation_targets !== undefined) {
    if (!Array.isArray(o.automation_targets)) {
      errors.push("automation_targets must be an array if present");
    } else {
      for (const t of o.automation_targets) {
        if (typeof t !== "string" || !automationIds.has(t)) {
          errors.push(`automation_targets: unknown target ${JSON.stringify(t)}`);
        }
      }
    }
  }
  if (o.kind === "system" && o.system_class === "virtual") {
    if (typeof o.hosted_on_system_id !== "string" || !o.hosted_on_system_id.trim()) {
      errors.push("system with system_class virtual requires non-empty hosted_on_system_id");
    }
  }
  if (o.kind === "system" && o.services !== undefined) {
    if (!Array.isArray(o.services)) {
      errors.push("services must be an array if present");
    } else {
      const idToKind = refContext?.idToKind;
      const nodeNames = accessNodeNames(o);
      for (let i = 0; i < o.services.length; i++) {
        const row = o.services[i];
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          errors.push(`services[${i}]: must be an object`);
          continue;
        }
        const r = /** @type {Record<string, unknown>} */ (row);
        for (const k of Object.keys(r)) {
          if (k !== "id" && k !== "nodes") {
            errors.push(`services[${i}]: unknown key ${JSON.stringify(k)} (only id and nodes allowed)`);
          }
        }
        if (typeof r.id !== "string" || !r.id.trim()) {
          errors.push(`services[${i}]: id must be a non-empty string (inventory id of a kind services sidecar)`);
          continue;
        }
        const sid = r.id.trim();
        if (r.nodes !== undefined && (!Array.isArray(r.nodes) || !r.nodes.every((x) => typeof x === "string"))) {
          errors.push(`services[${i}]: nodes must be an array of strings if present`);
          continue;
        }
        if (!idToKind) {
          errors.push("system.services requires inventory id index (use docs lint from the hdc CLI)");
          break;
        }
        const knd = idToKind.get(sid);
        if (knd === undefined) {
          errors.push(`services[${i}]: no inventory sidecar with id ${JSON.stringify(sid)}`);
        } else if (knd !== "services") {
          errors.push(
            `services[${i}]: id ${JSON.stringify(sid)} must reference kind services, got ${JSON.stringify(knd)}`,
          );
        }
        if (Array.isArray(r.nodes) && nodeNames.size > 0) {
          for (const nn of r.nodes) {
            if (typeof nn === "string" && nn.trim() && !nodeNames.has(nn.trim())) {
              errors.push(
                `services[${i}]: nodes contains ${JSON.stringify(nn)} which is not an access.nodes[].name on this system`,
              );
            }
          }
        }
      }
    }
  }
  if (o.last_verified !== undefined && o.last_verified !== null && typeof o.last_verified !== "string") {
    errors.push("last_verified must be a string or null if present");
  }
  if (o.notes !== undefined && typeof o.notes !== "string") {
    errors.push("notes must be a string if present");
  }
  if (o.proxmox_cluster !== undefined) {
    const pc = o.proxmox_cluster;
    if (typeof pc !== "object" || pc === null || Array.isArray(pc)) {
      errors.push("proxmox_cluster must be an object if present");
    } else {
      const poc = /** @type {Record<string, unknown>} */ (pc);
      const allowedPc = new Set(["id", "role"]);
      for (const k of Object.keys(poc)) {
        if (!allowedPc.has(k)) {
          errors.push(`proxmox_cluster: unknown key ${JSON.stringify(k)}`);
        }
      }
      const pid = typeof poc.id === "string" ? poc.id.trim() : "";
      if (!pid) {
        errors.push("proxmox_cluster.id must be a non-empty string");
      }
      const role = typeof poc.role === "string" ? poc.role.trim() : "";
      if (role !== "node" && role !== "standalone") {
        errors.push('proxmox_cluster.role must be "node" or "standalone"');
      }
    }
  }
  const sec = scanForSecrets(o);
  errors.push(...sec);
  return errors;
}

/**
 * @param {unknown} v
 * @param {string} prefix
 */
function validateAuthRefs(v, prefix) {
  /** @type {string[]} */
  const errors = [];
  if (v === undefined) return errors;
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }
  for (const [k, val] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      errors.push(...validateAuthRefs(val, `${prefix}.${k}`));
    } else if (typeof val === "string") {
      if (!ENV_VAR_NAME.test(val)) {
        errors.push(`${prefix}.${k}: expected env var name like HDC_FOO, got ${JSON.stringify(val)}`);
      }
    } else if (val !== undefined) {
      errors.push(`${prefix}.${k}: must be string (env var name) or nested object`);
    }
  }
  return errors;
}

/**
 * @param {unknown} data
 * @returns {string[]}
 */
export function scanForSecrets(data) {
  /** @type {string[]} */
  const hits = [];
  const visit = (v, path) => {
    if (typeof v === "string") {
      if (v.includes("BEGIN PRIVATE KEY") || v.includes("BEGIN RSA PRIVATE KEY")) {
        hits.push(`${path}: possible PEM secret`);
      }
      if (v.length > 120 && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.replace(/\s/g, "").length > 80) {
        hits.push(`${path}: possible long base64/blob`);
      }
      if (/password\s*=\s*\S+/i.test(v) && v.length > 24) {
        hits.push(`${path}: possible password material`);
      }
    } else if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        v.forEach((x, i) => visit(x, `${path}[${i}]`));
      } else {
        for (const [k, x] of Object.entries(v)) {
          visit(x, `${path}.${k}`);
        }
      }
    }
  };
  visit(data, "$");
  return hits;
}

/**
 * @param {string} root
 * @returns {Set<string>}
 */
export function automationTargetIds(root) {
  const auto = automationDir(root);
  const ids = new Set();
  if (!existsSync(auto)) return ids;
  for (const name of readdirSync(auto, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const mf = join(auto, name.name, "manifest.json");
    if (existsSync(mf)) {
      try {
        const raw = JSON.parse(readFileSync(mf, "utf8"));
        if (raw && typeof raw.id === "string" && raw.id.trim()) {
          ids.add(raw.id.trim());
        } else {
          ids.add(name.name);
        }
      } catch {
        ids.add(name.name);
      }
    }
  }
  return ids;
}

/**
 * @param {Record<string, unknown>} sidecar
 * @returns {string}
 */
export function renderInventoryMarkdown(sidecar) {
  const lines = [];
  const hw = sidecar.hardware;
  if (Array.isArray(hw) && hw.length > 0) {
    lines.push("## Hardware (synced)", "");
    lines.push(
      "| Name | Description | CPU | Cores | Memory | Memory capacity | Storage | Storage capacity |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of hw) {
      if (!row || typeof row !== "object") continue;
      const r = /** @type {Record<string, string>} */ (row);
      const cells = ["name", "description", "cpu", "cores", "memory", "memory_capacity", "storage", "storage_capacity"].map(
        (k) => escapeCell(String(r[k] ?? "")),
      );
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  const nodes = sidecar.access && typeof sidecar.access === "object" && !Array.isArray(sidecar.access) ? sidecar.access.nodes : null;
  if (Array.isArray(nodes) && nodes.length > 0) {
    lines.push("## Network (synced)", "");
    lines.push("| Node | Hostname(s) | IP(s) |");
    lines.push("| --- | --- | --- |");
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const o = /** @type {Record<string, unknown>} */ (n);
      const name = escapeCell(String(o.name ?? ""));
      const hosts = Array.isArray(o.hostnames) ? o.hostnames.map(String).join(", ") : String(o.hostnames ?? "");
      const ip = escapeCell(String(o.ip ?? ""));
      lines.push(`| ${name} | ${escapeCell(hosts)} | ${ip} |`);
    }
    lines.push("");
    lines.push("## Management (synced)", "");
    lines.push("| Node | Interfaces |");
    lines.push("| --- | --- |");
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const o = /** @type {Record<string, unknown>} */ (n);
      const name = escapeCell(String(o.name ?? ""));
      const web = String(o.web_ui ?? "");
      const ssh = String(o.ssh ?? "");
      const parts = [];
      if (web) parts.push(`[Web UI](${web})`);
      if (ssh) parts.push(`[SSH](${ssh})`);
      const cell = escapeCell(parts.join(", "));
      lines.push(`| ${name} | ${cell} |`);
    }
    lines.push("");
  }
  if (lines.length === 0) {
    lines.push("_No tabular inventory fields to render._", "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function escapeCell(s) {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * @param {string} mdPath
 * @param {string} block
 * @param {boolean} dryRun
 */
export function syncMarkdownMarkers(mdPath, block, dryRun) {
  if (!existsSync(mdPath)) {
    return { ok: false, message: `markdown not found: ${mdPath}` };
  }
  const text = readFileSync(mdPath, "utf8");
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end <= start) {
    return {
      ok: false,
      message: `Add markers to ${mdPath}:\n${MARKER_START}\n${MARKER_END}`,
    };
  }
  const innerStart = start + MARKER_START.length;
  const before = text.slice(0, innerStart);
  const after = text.slice(end);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const newText = `${before}${newline}${block}${after}`;
  if (!dryRun) {
    writeFileSync(mdPath, newText, "utf8");
  }
  return { ok: true, message: dryRun ? "dry-run: would update markers" : "updated markers" };
}

export { MARKER_START, MARKER_END };

/** JSON file beside each automation target's manifest; updated after a successful `query` run. */
export const AUTOMATION_TARGET_INVENTORY_FILENAME = "inventory.json";

/**
 * Merge parsed query JSON from process stdout into automation/<target>/inventory.json.
 * Preserves other top-level keys; sets query_last and last_verified.
 * @param {string} inventoryPath absolute path to inventory.json
 * @param {string} stdoutText raw stdout (trimmed; must be one JSON object)
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function mergeQueryStdoutIntoAutomationInventory(inventoryPath, stdoutText) {
  const t = stdoutText.trim();
  if (!t) return { ok: false, reason: "empty stdout" };
  let data;
  try {
    data = JSON.parse(t);
  } catch {
    return { ok: false, reason: "stdout is not valid JSON" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "stdout JSON must be a single object" };
  }
  let doc = {};
  if (existsSync(inventoryPath)) {
    try {
      doc = JSON.parse(readFileSync(inventoryPath, "utf8"));
    } catch {
      doc = {};
    }
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) doc = {};
  const o = /** @type {Record<string, unknown>} */ (doc);
  o.query_last = data;
  o.last_verified = new Date().toISOString();
  writeFileSync(inventoryPath, JSON.stringify(o, null, 2) + "\n", "utf8");
  return { ok: true };
}

/**
 * @param {string} sidecarPath
 * @param {string} jsonPath
 */
export function applyQueryToSidecar(sidecarPath, jsonPath) {
  const queryData = JSON.parse(readFileSync(jsonPath, "utf8"));
  let sidecar = {};
  if (existsSync(sidecarPath)) {
    sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
  }
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) {
    sidecar = {};
  }
  const o = /** @type {Record<string, unknown>} */ (sidecar);
  o.query_last = queryData;
  o.last_verified = new Date().toISOString();
  writeFileSync(sidecarPath, JSON.stringify(o, null, 2) + "\n", "utf8");
}

/**
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
export function tryParseJsonObject(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return /** @type {Record<string, unknown>} */ (v);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJsonObjectOrEmpty(path) {
  if (!existsSync(path)) return {};
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return /** @type {Record<string, unknown>} */ (v);
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Load `inventory/automated/systems.json` (machine-maintained). Missing file yields defaults.
 * @param {string} root
 * @returns {{ schema_version: number, last_updated: string | null, systems: Record<string, unknown>, sources: Record<string, unknown> }}
 */
export function loadAutomatedSystemsDoc(root) {
  const raw = readJsonObjectOrEmpty(inventoryAutomatedSystemsPath(root));
  const systems =
    raw.systems && typeof raw.systems === "object" && !Array.isArray(raw.systems)
      ? /** @type {Record<string, unknown>} */ (raw.systems)
      : {};
  const sources =
    raw.sources && typeof raw.sources === "object" && !Array.isArray(raw.sources)
      ? /** @type {Record<string, unknown>} */ (raw.sources)
      : {};
  return {
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 1,
    last_updated: typeof raw.last_updated === "string" ? raw.last_updated : null,
    systems,
    sources,
  };
}

/**
 * After a successful automation query/deploy, merge stdout payload (when JSON) into
 * `inventory/automated/systems.json`. Optional `systems` array on the payload merges per `id`.
 * @param {string} root
 * @param {string} pluginId
 * @param {"query" | "deploy" | string} verb
 * @param {Record<string, unknown> | null} payload parsed JSON object or null (e.g. deploy with no JSON stdout)
 */
export function mergeAutomatedSystemsFromPlugin(root, pluginId, verb, payload) {
  const path = inventoryAutomatedSystemsPath(root);
  const now = new Date().toISOString();
  const doc = loadAutomatedSystemsDoc(root);
  /** @type {Record<string, unknown>} */
  const out = {
    schema_version: 1,
    last_updated: now,
    systems: { ...doc.systems },
    sources: { ...doc.sources },
  };
  const prevSource =
    out.sources[pluginId] && typeof out.sources[pluginId] === "object" && !Array.isArray(out.sources[pluginId])
      ? /** @type {Record<string, unknown>} */ (out.sources[pluginId])
      : {};
  /** @type {Record<string, unknown>} */
  const src = { ...prevSource };
  if (verb === "query") src.last_query_at = now;
  if (verb === "deploy") src.last_deploy_at = now;
  if (payload) {
    src.last_payload = payload;
    const systems = payload.systems;
    if (Array.isArray(systems)) {
      for (const item of systems) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = /** @type {Record<string, unknown>} */ (item);
        const sid = typeof row.id === "string" ? row.id.trim() : "";
        if (!sid) continue;
        const prev =
          out.systems[sid] && typeof out.systems[sid] === "object" && !Array.isArray(out.systems[sid])
            ? /** @type {Record<string, unknown>} */ (out.systems[sid])
            : {};
        out.systems[sid] = {
          ...prev,
          ...row,
          _automated_source: pluginId,
          _automated_verb: verb,
          _automated_at: now,
        };
      }
    }
  }
  out.sources[pluginId] = src;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
}

/**
 * @param {string} root
 * @param {string} id
 * @returns {Record<string, unknown> | null}
 */
export function readManualSidecarById(root, id) {
  const want = id.trim();
  if (!want) return null;
  for (const p of findInventorySidecars(root)) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const o = /** @type {Record<string, unknown>} */ (data);
      if (typeof o.id === "string" && o.id.trim() === want) {
        return o;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/**
 * Automated overlay wins on key conflicts (shallow merge). Missing both returns null.
 * @param {string} root
 * @param {string} id
 * @returns {Record<string, unknown> | null}
 */
export function resolveSystemById(root, id) {
  const manual = readManualSidecarById(root, id);
  const doc = loadAutomatedSystemsDoc(root);
  const auto =
    doc.systems[id] && typeof doc.systems[id] === "object" && !Array.isArray(doc.systems[id])
      ? /** @type {Record<string, unknown>} */ (doc.systems[id])
      : null;
  if (!manual && !auto) return null;
  if (!manual) return auto;
  if (!auto) return manual;
  return { ...manual, ...auto };
}
