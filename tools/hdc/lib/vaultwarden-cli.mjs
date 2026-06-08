import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Process-wide Bitwarden session cache (one unlock per hdc command). */
/** @type {string | null} */
let processBwSession = null;

/** @internal Test helper */
export function clearBwSessionProcessCache() {
  processBwSession = null;
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
 * Resolve how to invoke `bw` without a shell (npm shims on Windows need node + bw.js).
 * @param {VaultwardenCliDeps} deps
 * @returns {{ command: string; prefixArgs: string[] }}
 */
export function resolveBwCommand(deps) {
  const override = String(deps.env.HDC_BW_EXECUTABLE ?? "").trim();
  if (override) return { command: override, prefixArgs: [] };

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
 * @returns {string}
 */
export function resolveBwExecutable(deps) {
  const { command, prefixArgs } = resolveBwCommand(deps);
  return prefixArgs[0] ?? command;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string[]} args
 * @param {{ capture?: boolean; session?: string; password?: string; allowMissing?: boolean }} [opts]
 */
function spawnBw(deps, bwArgs, opts = {}) {
  const { command, prefixArgs } = resolveBwCommand(deps);
  const spawn = deps.spawnSync ?? spawnSync;
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...deps.env };
  if (opts.session) env.BW_SESSION = opts.session;
  if (opts.password) env.BW_PASSWORD = opts.password;
  const r = spawn(command, [...prefixArgs, ...bwArgs], {
    encoding: "utf8",
    env,
    shell: false,
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
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
 * @param {string} url
 */
export function ensureBwConfigured(deps, url) {
  deps.log(`[hdc] vaultwarden: configuring bw server ${url}`);
  const r = spawnBw(deps, ["config", "server", url], { capture: true });
  if (!r.ok) {
    throw new Error(`bw config server failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
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
 * @param {VaultwardenCliDeps} deps
 * @param {() => Promise<string | null>} readLocalSecret Read bootstrap key from local hdc vault.
 * @param {(key: string, value: string) => Promise<void>} writeLocalSecret
 * @returns {Promise<string>} BW session key
 */
export async function ensureBwUnlocked(deps, readLocalSecret, writeLocalSecret) {
  if (processBwSession) return processBwSession;

  const url = String(deps.env.HDC_VAULTWARDEN_URL ?? "").trim();
  const email = String(deps.env.HDC_VAULTWARDEN_EMAIL ?? "").trim();
  if (!url || !email) {
    throw new Error("HDC_VAULTWARDEN_URL and HDC_VAULTWARDEN_EMAIL must be set for the vaultwarden secret backend");
  }

  ensureBwConfigured(deps, url);

  /** @type {string | null} */
  let masterPassword = null;
  /** @type {boolean} */
  let passwordFromPrompt = false;

  const stored = await readLocalSecret("HDC_VAULTWARDEN_MASTER_PASSWORD");
  if (typeof stored === "string" && stored.length > 0) {
    masterPassword = stored;
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
 * @param {string} itemName
 * @returns {string | null}
 */
export function bwGetPassword(deps, session, itemName) {
  const r = spawnBw(deps, ["get", "password", itemName], { capture: true, session });
  if (!r.ok) {
    const msg = (r.stderr || r.stdout || "").toLowerCase();
    if (msg.includes("not found") || msg.includes("multiple objects")) return null;
    throw new Error(`bw get password failed for ${itemName}: ${r.stderr || r.stdout || "unknown error"}`);
  }
  return r.stdout.length > 0 ? r.stdout : null;
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 */
function bwFindItemId(deps, session, itemName) {
  const r = spawnBw(deps, ["list", "items", "--search", itemName], { capture: true, session });
  if (!r.ok || !r.stdout) return null;
  try {
    const items = JSON.parse(r.stdout);
    if (!Array.isArray(items)) return null;
    const exact = items.find((it) => it && typeof it === "object" && it.name === itemName);
    return exact && typeof exact.id === "string" ? exact.id : null;
  } catch {
    return null;
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 * @param {string} value
 */
export function bwSetPassword(deps, session, itemName, value) {
  const existingId = bwFindItemId(deps, session, itemName);
  if (existingId) {
    const r = spawnBw(
      deps,
      ["edit", "item", existingId, "--password", value],
      { capture: true, session },
    );
    if (!r.ok) {
      throw new Error(`bw edit item failed for ${itemName}: ${r.stderr || r.stdout || "unknown error"}`);
    }
    return;
  }
  const r = spawnBw(
    deps,
    ["create", "item", "login", "--name", itemName, "--username", itemName, "--password", value],
    { capture: true, session },
  );
  if (!r.ok) {
    throw new Error(`bw create item failed for ${itemName}: ${r.stderr || r.stdout || "unknown error"}`);
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @returns {string[]}
 */
export function bwListItemNames(deps, session) {
  const r = spawnBw(deps, ["list", "items"], { capture: true, session });
  if (!r.ok || !r.stdout) return [];
  try {
    const items = JSON.parse(r.stdout);
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => (it && typeof it === "object" && typeof it.name === "string" ? it.name : null))
      .filter((n) => typeof n === "string" && n.length > 0)
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {VaultwardenCliDeps} deps
 * @param {string} session
 * @param {string} itemName
 */
export function bwDeleteItem(deps, session, itemName) {
  const id = bwFindItemId(deps, session, itemName);
  if (!id) return false;
  const r = spawnBw(deps, ["delete", "item", id], { capture: true, session });
  if (!r.ok) {
    throw new Error(`bw delete item failed for ${itemName}: ${r.stderr || r.stdout || "unknown error"}`);
  }
  return true;
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
