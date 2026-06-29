import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  vaultwardenCollectionIdFromEnv,
  vaultwardenOrganizationIdFromEnv,
  vaultwardenOrganizationNameFromEnv,
} from "./secret-backend.mjs";

/** Process-wide Bitwarden session cache (one unlock per hdc command). */
/** @type {string | null} */
let processBwSession = null;

/** @type {string | null} */
let processBwOrganizationId = null;

/** @type {string | null} */
let processBwCollectionId = null;

/** @type {Array<{ id: string; name: string; organizationId?: string }> | null} */
let processBwOrgItems = null;

/** Full cipher objects from the last `list items` call (passwords when vault is unlocked). */
/** @type {Array<Record<string, unknown>> | null} */
let processBwOrgFullItems = null;

/** @type {{ command: string; prefixArgs: string[] } | null} */
let cachedBwCommand = null;

/** @type {Promise<string> | null} */
let processBwUnlockPromise = null;

/** @internal Test helper */
export function clearBwSessionProcessCache() {
  processBwSession = null;
  processBwOrganizationId = null;
  processBwCollectionId = null;
  processBwOrgItems = null;
  processBwOrgFullItems = null;
  cachedBwCommand = null;
  processBwUnlockPromise = null;
}

/**
 * Bitwarden session for the current hdc process (after unlock). Used to pass BW_SESSION to child package scripts.
 * @returns {string | null}
 */
export function getProcessBwSession() {
  return processBwSession;
}

/**
 * @typedef {object} VaultwardenCliDeps
 * @property {NodeJS.ProcessEnv} env
 * @property {(...args: unknown[]) => void} log
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} warn
 * @property {(q: string, opts?: { mask?: boolean }) => Promise<string>} readLineQuestion
 * @property {typeof spawnSync} [spawnSync]
 */

/**
 * When HDC_BW_EXECUTABLE points at an npm shim (.cmd/.ps1), run node + bw.js instead.
 * @param {string} override
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ command: string; prefixArgs: string[] } | null}
 */
function resolveBwFromExecutableOverride(override, env) {
  if (process.platform !== "win32") return null;
  if (!/\.(cmd|bat|ps1)$/i.test(override)) return null;
  const npmDir = join(override, "..");
  const bwJs = join(npmDir, "node_modules/@bitwarden/cli/build/bw.js");
  if (!existsSync(bwJs)) return null;
  const node = typeof env.NODE === "string" && env.NODE.trim() ? env.NODE.trim() : process.execPath;
  return { command: node, prefixArgs: [bwJs] };
}

/**
 * Resolve how to invoke `bw` without a shell (npm shims on Windows need node + bw.js).
 * @param {VaultwardenCliDeps} deps
 * @returns {{ command: string; prefixArgs: string[] }}
 */
function resolveBwCommandUncached(deps) {
  const override = String(deps.env.HDC_BW_EXECUTABLE ?? "").trim();
  if (override) {
    const shim = resolveBwFromExecutableOverride(override, deps.env);
    if (shim) return shim;
    return { command: override, prefixArgs: [] };
  }

  const spawn = deps.spawnSync ?? spawnSync;

  if (process.platform === "win32") {
    const bwJs = join(deps.env.APPDATA ?? "", "npm/node_modules/@bitwarden/cli/build/bw.js");
    if (existsSync(bwJs)) {
      const r = spawn(process.execPath, [bwJs, "--version"], {
        encoding: "utf8",
        env: deps.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (r.status === 0) {
        return { command: process.execPath, prefixArgs: [bwJs] };
      }
    }
  }

  /** @type {string[]} */
  const candidates = ["bw", "bw.exe"];
  if (process.platform === "win32") {
    const npmDir = join(deps.env.APPDATA ?? "", "npm");
    candidates.push(join(npmDir, "bw.exe"));
  }
  for (const exe of candidates) {
    if (exe.includes("npm") && !existsSync(exe)) continue;
    const r = spawn(exe, ["--version"], {
      encoding: "utf8",
      env: deps.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status === 0) return { command: exe, prefixArgs: [] };
  }

  deps.error(
    "Bitwarden CLI (bw) not found on PATH. Install from https://bitwarden.com/help/cli/ and see docs/manually-deployed/bitwarden-cli.md",
  );
  throw new Error("bw not found");
}

/**
 * @param {VaultwardenCliDeps} deps
 * @returns {{ command: string; prefixArgs: string[] }}
 */
export function resolveBwCommand(deps) {
  if (cachedBwCommand) return cachedBwCommand;
  cachedBwCommand = resolveBwCommandUncached(deps);
  return cachedBwCommand;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @returns {string}
 */
export function resolveBwExecutable(deps) {
  const { command, prefixArgs } = resolveBwCommand(deps);
  return prefixArgs[0] ?? command;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string[]} args
 * @param {{ capture?: boolean; session?: string; password?: string; allowMissing?: boolean; stdin?: string }} [opts]
 */
function spawnBw(deps, bwArgs, opts = {}) {
  const { command, prefixArgs } = resolveBwCommand(deps);
  const spawn = deps.spawnSync ?? spawnSync;
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...deps.env };
  if (opts.password) {
    delete env.BW_SESSION;
    env.BW_PASSWORD = opts.password;
  }
  if (opts.session) env.BW_SESSION = opts.session;
  const r = spawn(command, [...prefixArgs, ...bwArgs], {
    encoding: "utf8",
    env,
    shell: false,
    input: opts.stdin,
    stdio: opts.stdin
      ? ["pipe", opts.capture ? "pipe" : "inherit", opts.capture ? "pipe" : "inherit"]
      : opts.capture
        ? ["ignore", "pipe", "pipe"]
        : "inherit",
  });
  const stdout = typeof r.stdout === "string" ? r.stdout.trim() : "";
  const stderr = typeof r.stderr === "string" ? r.stderr.trim() : "";
  const errMsg = r.error && typeof r.error === "object" && "message" in r.error ? String(r.error.message) : "";
  const ok = r.status === 0;
  if (!ok && !opts.allowMissing && (stderr || errMsg) && !opts.capture) {
    deps.warn(`[hdc] bw ${bwArgs.join(" ")} failed: ${(stderr || errMsg).split("\n")[0]}`);
  }
  return { ok, status: r.status ?? 1, stdout, stderr: stderr || errMsg };
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {unknown} value
 * @returns {string}
 */
function bwEncodeJson(deps, value) {
  const r = spawnBw(deps, ["encode"], { capture: true, stdin: JSON.stringify(value) });
  if (!r.ok || !r.stdout) {
    throw new Error(`bw encode failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
  return r.stdout;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemId
 * @returns {Record<string, unknown>}
 */
function bwGetItem(deps, session, itemId) {
  const r = spawnBw(deps, ["get", "item", itemId], { capture: true, session });
  if (!r.ok || !r.stdout) {
    throw new Error(`bw get item failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
  try {
    const parsed = JSON.parse(r.stdout);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid item JSON");
    }
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`bw get item returned invalid JSON: ${msg}`);
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemId
 * @param {string} password
 */
function bwUpdateLoginPassword(deps, session, itemId, password) {
  const item = bwGetItem(deps, session, itemId);
  const login =
    item.login && typeof item.login === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...item.login })
      : {};
  login.password = password;
  item.login = login;
  const encoded = bwEncodeJson(deps, item);
  const r = spawnBw(deps, ["edit", "item", itemId, encoded], { capture: true, session });
  if (!r.ok) {
    throw new Error(`bw edit item failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {{ name: string; password: string; organizationId: string; collectionId: string }} opts
 * @returns {string | null} created item id when returned by bw
 */
function bwCreateOrgLoginItem(deps, session, opts) {
  const item = {
    organizationId: opts.organizationId,
    collectionIds: [opts.collectionId],
    type: 1,
    name: opts.name,
    login: {
      uris: [],
      username: opts.name,
      password: opts.password,
      totp: null,
    },
  };

  const encoded = bwEncodeJson(deps, item);
  const r = spawnBw(deps, ["create", "item", encoded], { capture: true, session });
  if (!r.ok) {
    throw new Error(`bw create item failed for ${opts.name}: ${r.stderr || r.stdout || "unknown error"}`);
  }

  try {
    const created = JSON.parse(r.stdout);
    if (created && typeof created === "object" && typeof created.id === "string") {
      return created.id;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} url
 */
export function ensureBwConfigured(deps, url) {
  const r = spawnBw(deps, ["config", "server", url], { capture: true, allowMissing: true });
  if (r.ok) {
    deps.log(`[hdc] vaultwarden: configuring bw server ${url}`);
    return;
  }
  const msg = (r.stderr || r.stdout || "").toLowerCase();
  if (msg.includes("logout required") && bwLoginCheck(deps).ok) {
    deps.log(`[hdc] vaultwarden: bw already logged in (server config unchanged)`);
    return;
  }
  throw new Error(`bw config server failed: ${r.stderr || r.stdout || "unknown error"}`);
}

/**
 * @param {VaultwardenCliDeps} deps
 */
function bwLoginCheck(deps) {
  return spawnBw(deps, ["login", "--check"], { capture: true, allowMissing: true });
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} email
 * @param {string} masterPassword
 */
function bwLogin(deps, email, masterPassword) {
  deps.log(`[hdc] vaultwarden: logging in as ${email}`);
  const r = spawnBw(deps, ["login", email, masterPassword, "--raw"], { capture: true, password: masterPassword });
  if (!r.ok) {
    throw new Error(`bw login failed: ${r.stderr || r.stdout || "invalid credentials"}`);
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} masterPassword
 * @returns {string}
 */
function bwUnlockRaw(deps, masterPassword) {
  const r = spawnBw(deps, ["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
    capture: true,
    password: masterPassword,
  });
  if (!r.ok || !r.stdout) {
    throw new Error(`bw unlock failed: ${r.stderr || r.stdout || "invalid master password"}`);
  }
  return r.stdout.trim();
}

/**
 * @param {string} msg
 * @returns {string}
 */
function formatBwErrorMessage(msg) {
  const raw = String(msg || "unknown error");
  const firstLine = raw.split("\n")[0].trim();
  if (/master password/i.test(firstLine)) {
    return "session invalid (master password required)";
  }
  if (firstLine.includes("ERR_USE_AFTER_CLOSE")) {
    return "session invalid (bw interactive prompt failed)";
  }
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 */
function bwSessionIsValid(deps, session) {
  const collectionId = vaultwardenCollectionIdFromEnv(deps.env);
  if (collectionId) {
    const r = spawnBw(deps, ["list", "items", "--collectionid", collectionId], {
      capture: true,
      session,
      allowMissing: true,
    });
    return r.ok;
  }
  const r = spawnBw(deps, ["list", "organizations"], { capture: true, session, allowMissing: true });
  return r.ok;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @returns {Array<{ id: string; name: string }>}
 */
function bwListOrganizations(deps, session) {
  const r = spawnBw(deps, ["list", "organizations"], { capture: true, session });
  if (!r.ok || !r.stdout) {
    throw new Error(
      `bw list organizations failed: ${formatBwErrorMessage(r.stderr || r.stdout)}; set HDC_VAULTWARDEN_ORGANIZATION_ID in .env`,
    );
  }
  let orgs;
  try {
    orgs = JSON.parse(r.stdout);
  } catch {
    throw new Error("bw list organizations returned invalid JSON");
  }
  if (!Array.isArray(orgs)) {
    throw new Error("bw list organizations returned unexpected data");
  }
  return orgs
    .map((o) =>
      o && typeof o === "object" && typeof o.id === "string" && typeof o.name === "string"
        ? { id: o.id, name: o.name }
        : null,
    )
    .filter((o) => o !== null);
}

/**
 * @param {Array<{ id: string; name: string }>} orgs
 */
function formatOrganizationChoices(orgs) {
  if (orgs.length === 0) return "none";
  return orgs.map((o) => `${o.name} (${o.id})`).join(", ");
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @returns {string}
 */
export function resolveBwOrganizationId(deps, session) {
  if (processBwOrganizationId) return processBwOrganizationId;

  const fromEnv = vaultwardenOrganizationIdFromEnv(deps.env);
  if (fromEnv) {
    processBwOrganizationId = fromEnv;
    return fromEnv;
  }

  const orgs = bwListOrganizations(deps, session);
  const name = vaultwardenOrganizationNameFromEnv(deps.env);
  const byName = orgs.find((o) => o.name === name);
  if (byName) {
    processBwOrganizationId = byName.id;
    return byName.id;
  }

  const email = String(deps.env.HDC_VAULTWARDEN_EMAIL ?? "").trim() || "your account";
  if (fromEnv && orgs.length === 0) {
    throw new Error(
      `HDC_VAULTWARDEN_ORGANIZATION_ID is set but ${email} has no Vaultwarden organizations (bw list organizations returned none). ` +
        "Create or join organization " +
        JSON.stringify(name) +
        " in the Vaultwarden web UI, accept any invitation, run bw sync, then set HDC_VAULTWARDEN_ORGANIZATION_ID to the id from bw list organizations. " +
        "Remove the current value if it was copied from the Vaultwarden admin panel.",
    );
  }
  if (fromEnv) {
    throw new Error(
      `HDC_VAULTWARDEN_ORGANIZATION_ID ${JSON.stringify(fromEnv)} is not accessible to ${email}. ` +
        `Available organizations: ${formatOrganizationChoices(orgs)}. ` +
        "Update .env with an id from bw list organizations.",
    );
  }
  throw new Error(
    `Vaultwarden organization ${JSON.stringify(name)} not found for ${email} (available: ${formatOrganizationChoices(orgs)}). ` +
      "Create the organization in the Vaultwarden web UI or set HDC_VAULTWARDEN_ORGANIZATION_ID in .env.",
  );
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} orgId
 * @returns {string}
 */
export function resolveBwCollectionId(deps, session, orgId) {
  if (processBwCollectionId) return processBwCollectionId;

  const fromEnv = vaultwardenCollectionIdFromEnv(deps.env);
  if (!fromEnv) {
    throw new Error(
      "HDC_VAULTWARDEN_COLLECTION_ID must be set in .env for the vaultwarden secret backend (bw list org-collections --organizationid <orgId>)",
    );
  }

  processBwCollectionId = fromEnv;
  return fromEnv;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @returns {{ organizationId: string; collectionId: string }}
 */
export function resolveBwOrgContext(deps, session) {
  const organizationId = resolveBwOrganizationId(deps, session);
  const collectionId = resolveBwCollectionId(deps, session, organizationId);
  return { organizationId, collectionId };
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {() => Promise<string | null>} readLocalSecret Read bootstrap key from local hdc vault.
 * @param {(key: string, value: string) => Promise<void>} writeLocalSecret
 * @returns {Promise<string>} BW session key
 */
export async function ensureBwUnlocked(deps, readLocalSecret, writeLocalSecret) {
  if (processBwSession) return processBwSession;
  if (!processBwUnlockPromise) {
    processBwUnlockPromise = ensureBwUnlockedInner(deps, readLocalSecret, writeLocalSecret).finally(() => {
      processBwUnlockPromise = null;
    });
  }
  return processBwUnlockPromise;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {() => Promise<string | null>} readLocalSecret
 * @param {(key: string, value: string) => Promise<void>} writeLocalSecret
 * @returns {Promise<string>}
 */
async function ensureBwUnlockedInner(deps, readLocalSecret, writeLocalSecret) {
  if (processBwSession) return processBwSession;

  const url = String(deps.env.HDC_VAULTWARDEN_URL ?? "").trim();
  const email = String(deps.env.HDC_VAULTWARDEN_EMAIL ?? "").trim();
  if (!url || !email) {
    throw new Error("HDC_VAULTWARDEN_URL and HDC_VAULTWARDEN_EMAIL must be set for the vaultwarden secret backend");
  }

  ensureBwConfigured(deps, url);

  const inheritedSession = String(deps.env.BW_SESSION ?? "").trim();
  if (inheritedSession && bwSessionIsValid(deps, inheritedSession)) {
    processBwSession = inheritedSession;
    deps.log("[hdc] vaultwarden: reusing BW_SESSION from environment.");
    return processBwSession;
  }

  /** @type {string | null} */
  let masterPassword = null;
  /** @type {boolean} */
  let passwordFromPrompt = false;

  const stored = await readLocalSecret("HDC_VAULTWARDEN_MASTER_PASSWORD");
  if (typeof stored === "string" && stored.length > 0) {
    masterPassword = stored;
  }
  if (!masterPassword) {
    const fromEnv = String(deps.env.HDC_VAULTWARDEN_MASTER_PASSWORD ?? "").trim();
    if (fromEnv) masterPassword = fromEnv;
  }

  if (!masterPassword) {
    masterPassword = await deps.readLineQuestion("Vaultwarden master password: ", { mask: true });
    passwordFromPrompt = true;
    if (!masterPassword) {
      deps.error("Aborted (empty Vaultwarden master password).");
      throw new Error("empty Vaultwarden master password");
    }
  }

  if (!bwLoginCheck(deps).ok) {
    bwLogin(deps, email, masterPassword);
  }

  let session;
  try {
    session = bwUnlockRaw(deps, masterPassword);
  } catch (e) {
    if (!passwordFromPrompt) {
      deps.warn("Stored Vaultwarden master password did not unlock; enter it interactively.");
      masterPassword = await deps.readLineQuestion("Vaultwarden master password: ", { mask: true });
      passwordFromPrompt = true;
      if (!bwLoginCheck(deps).ok) {
        bwLogin(deps, email, masterPassword);
      }
      session = bwUnlockRaw(deps, masterPassword);
    } else {
      throw e;
    }
  }

  if (!bwSessionIsValid(deps, session)) {
    throw new Error("bw unlock returned a session that failed validation");
  }

  processBwSession = session;
  deps.log("[hdc] vaultwarden: vault unlocked (session cached for this command).");

  if (passwordFromPrompt) {
    const storedAfter = await readLocalSecret("HDC_VAULTWARDEN_MASTER_PASSWORD");
    if (!storedAfter) {
      const save = await deps.readLineQuestion("Store Vaultwarden master password in hdc vault? [y/N]: ", {
        mask: false,
      });
      if (/^y(es)?$/i.test(save.trim())) {
        await writeLocalSecret("HDC_VAULTWARDEN_MASTER_PASSWORD", masterPassword);
        deps.log("[hdc] vaultwarden: saved HDC_VAULTWARDEN_MASTER_PASSWORD to local hdc vault.");
      }
    }
  }

  return session;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} stdout
 * @returns {Array<Record<string, unknown>>}
 */
function parseBwItemList(stdout) {
  if (!stdout) return [];
  try {
    const items = JSON.parse(stdout);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} organizationId
 * @param {string} collectionId
 * @returns {Array<{ id: string; name: string; organizationId?: string }>}
 */
function bwFetchOrgFullItems(deps, session, organizationId, collectionId) {
  if (processBwOrgFullItems) return processBwOrgFullItems;
  const r = spawnBw(deps, ["list", "items", "--collectionid", collectionId], { capture: true, session });
  if (!r.ok || !r.stdout) {
    processBwOrgFullItems = [];
    processBwOrgItems = [];
    return processBwOrgFullItems;
  }
  const items = parseBwItemList(r.stdout);
  processBwOrgFullItems = items.filter((it) => {
    if (!it || typeof it !== "object" || typeof it.name !== "string" || typeof it.id !== "string") {
      return false;
    }
    return it.organizationId === organizationId;
  });
  processBwOrgItems = processBwOrgFullItems.map((it) => ({
    id: /** @type {string} */ (it.id),
    name: /** @type {string} */ (it.name),
    organizationId: typeof it.organizationId === "string" ? it.organizationId : undefined,
  }));
  return processBwOrgFullItems;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} organizationId
 * @param {string} collectionId
 * @returns {Array<{ id: string; name: string; organizationId?: string }>}
 */
function bwListOrgItems(deps, session, organizationId, collectionId) {
  bwFetchOrgFullItems(deps, session, organizationId, collectionId);
  return processBwOrgItems ?? [];
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @param {string} organizationId
 * @returns {Record<string, unknown> | null}
 */
function bwFindOrgFullItem(deps, session, itemName, organizationId) {
  const { collectionId } = resolveBwOrgContext(deps, session);
  const items = bwFetchOrgFullItems(deps, session, organizationId, collectionId);
  const exact = items.find((it) => it.name === itemName);
  return exact ?? null;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @param {string | null} organizationId null = personal vault only
 */
function bwFindItemId(deps, session, itemName, organizationId) {
  if (organizationId) {
    const { collectionId } = resolveBwOrgContext(deps, session);
    const items = bwListOrgItems(deps, session, organizationId, collectionId);
    const exact = items.find((it) => it.name === itemName);
    return exact ? exact.id : null;
  }
  /** @type {string[]} */
  const args = ["list", "items", "--search", itemName];
  const r = spawnBw(deps, args, { capture: true, session });
  if (!r.ok) return null;
  const items = parseBwItemList(r.stdout);
  const exact = items.find((it) => {
    if (!it || typeof it !== "object" || it.name !== itemName || typeof it.id !== "string") return false;
    return !it.organizationId;
  });
  return exact && typeof exact.id === "string" ? exact.id : null;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemId
 * @param {string} organizationId
 * @param {string} collectionId
 */
function bwAssignItemToCollection(deps, session, itemId, organizationId, collectionId) {
  const encoded = bwEncodeJson(deps, [collectionId]);
  const r = spawnBw(
    deps,
    ["edit", "item-collections", itemId, encoded, "--organizationid", organizationId],
    { capture: true, session },
  );
  if (!r.ok) {
    throw new Error(`bw edit item-collections failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemId
 * @param {string} organizationId
 * @param {string} collectionId
 */
function bwMoveItemToOrg(deps, session, itemId, organizationId, collectionId) {
  const encoded = bwEncodeJson(deps, [collectionId]);
  const r = spawnBw(deps, ["move", itemId, organizationId, encoded], { capture: true, session });
  if (!r.ok) {
    throw new Error(`bw move failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
}

/**
 * Read hdc secret value from a Bitwarden item (login password or secure-note body).
 * @param {Record<string, unknown>} item
 * @returns {string | null}
 */
function extractSecretFromBwItem(item) {
  const login = item.login && typeof item.login === "object" ? item.login : null;
  if (login && typeof login.password === "string" && login.password.length > 0) {
    return login.password;
  }
  if (typeof item.notes === "string" && item.notes.length > 0) {
    return item.notes;
  }
  return null;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @returns {string | null}
 */
export function bwGetPassword(deps, session, itemName) {
  const { organizationId } = resolveBwOrgContext(deps, session);
  const cachedItem = bwFindOrgFullItem(deps, session, itemName, organizationId);
  if (cachedItem) {
    const fromList = extractSecretFromBwItem(cachedItem);
    if (typeof fromList === "string" && fromList.length > 0) return fromList;
  }
  const itemId = cachedItem && typeof cachedItem.id === "string" ? cachedItem.id : bwFindItemId(deps, session, itemName, organizationId);
  if (!itemId) return null;
  const r = spawnBw(deps, ["get", "password", itemId], { capture: true, session });
  if (r.ok && r.stdout.length > 0) return r.stdout;
  if (!r.ok) {
    const msg = (r.stderr || r.stdout || "").toLowerCase();
    if (msg.includes("not found") || msg.includes("multiple objects")) return null;
    if (msg.includes("no password available")) {
      try {
        return extractSecretFromBwItem(bwGetItem(deps, session, itemId));
      } catch {
        return null;
      }
    }
    throw new Error(`bw get password failed for ${itemName}: ${r.stderr || r.stdout || "unknown error"}`);
  }
  try {
    return extractSecretFromBwItem(bwGetItem(deps, session, itemId));
  } catch {
    return null;
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @returns {boolean}
 */
export function bwItemExistsInOrg(deps, session, itemName) {
  const { organizationId } = resolveBwOrgContext(deps, session);
  return Boolean(bwFindItemId(deps, session, itemName, organizationId));
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @returns {boolean}
 */
export function bwItemHasSecret(deps, session, itemName) {
  const value = bwGetPassword(deps, session, itemName);
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @param {string} value
 */
export function bwSetPassword(deps, session, itemName, value) {
  const { organizationId, collectionId } = resolveBwOrgContext(deps, session);

  processBwOrgFullItems = null;
  processBwOrgItems = null;

  const orgItemId = bwFindItemId(deps, session, itemName, organizationId);
  if (orgItemId) {
    try {
      bwUpdateLoginPassword(deps, session, orgItemId, value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`bw edit item failed for ${itemName}: ${msg}`);
    }
    return;
  }

  const personalItemId = bwFindItemId(deps, session, itemName, null);
  if (personalItemId) {
    bwMoveItemToOrg(deps, session, personalItemId, organizationId, collectionId);
    try {
      bwUpdateLoginPassword(deps, session, personalItemId, value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`bw edit item failed for ${itemName}: ${msg}`);
    }
    return;
  }

  const createdId = bwCreateOrgLoginItem(deps, session, {
    name: itemName,
    password: value,
    organizationId,
    collectionId,
  });
  if (!createdId) {
    const foundId = bwFindItemId(deps, session, itemName, organizationId);
    if (foundId) {
      bwAssignItemToCollection(deps, session, foundId, organizationId, collectionId);
    }
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @returns {string[]}
 */
export function bwListItemNames(deps, session) {
  const { organizationId, collectionId } = resolveBwOrgContext(deps, session);
  return bwListOrgItems(deps, session, organizationId, collectionId)
    .map((it) => it.name)
    .filter((n) => n.length > 0)
    .sort();
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 */
export function bwDeleteItem(deps, session, itemName) {
  const { organizationId } = resolveBwOrgContext(deps, session);
  const id = bwFindItemId(deps, session, itemName, organizationId);
  if (!id) return false;
  const r = spawnBw(deps, ["delete", "item", id], { capture: true, session });
  if (!r.ok) {
    throw new Error(`bw delete item failed for ${itemName}: ${r.stderr || r.stdout || "unknown error"}`);
  }
  processBwOrgFullItems = null;
  processBwOrgItems = null;
  return true;
}

/**
 * Read all hdc secrets from the HDC organization collection in one `list items` call when possible.
 * Falls back to per-item `get password` / `get item` when list payload lacks decrypted fields.
 *
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @returns {Record<string, string>}
 */
export function bwReadOrgSecrets(deps, session) {
  const { organizationId, collectionId } = resolveBwOrgContext(deps, session);
  const items = bwFetchOrgFullItems(deps, session, organizationId, collectionId);
  /** @type {Record<string, string>} */
  const out = {};
  for (const item of items) {
    if (typeof item.name !== "string" || !item.name) continue;
    let val = extractSecretFromBwItem(item);
    if (val === null && typeof item.id === "string") {
      val = bwGetPassword(deps, session, item.name);
    }
    if (typeof val === "string" && val.length > 0) out[item.name] = val;
  }
  return out;
}

/**
 * @param {Pick<VaultwardenCliDeps, "env" | "log" | "error" | "warn" | "readLineQuestion">} cliLike
 * @param {typeof spawnSync} [spawnSyncImpl]
 */
export function vaultwardenCliDepsFromCli(cliLike, spawnSyncImpl) {
  return {
    env: cliLike.env,
    log: cliLike.log,
    error: cliLike.error,
    warn: cliLike.warn,
    readLineQuestion: cliLike.readLineQuestion,
    spawnSync: spawnSyncImpl,
  };
}
