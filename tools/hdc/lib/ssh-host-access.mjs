import { chmodSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { inventoryIdToVaultSuffix } from "./users-bootstrap-hdc.mjs";

const PROXMOX_SSH_PASSWORD_PREFIX = "HDC_PROXMOX_SSH_PASSWORD";

/**
 * Vault key for a hypervisor SSH password (e.g. HDC_PROXMOX_SSH_PASSWORD_HYPERVISOR_A).
 * @param {string} hostInventoryId
 */
export function vaultKeyForProxmoxSshPassword(hostInventoryId) {
  return `${PROXMOX_SSH_PASSWORD_PREFIX}_${inventoryIdToVaultSuffix(hostInventoryId)}`;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listSshDirFiles(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Local ~/.ssh public keys and matching private key identities for OpenSSH.
 * @param {string} [sshDir]
 * @returns {{ publicKeyLines: string[]; identities: { privateKey: string; certificateFile?: string }[] }}
 */
export function discoverLocalSshMaterial(sshDir = join(homedir(), ".ssh")) {
  const files = listSshDirFiles(sshDir);
  /** @type {Set<string>} */
  const publicKeyLines = new Set();
  /** @type {Map<string, string>} */
  const certByBase = new Map();

  for (const name of files) {
    if (!name.endsWith(".pub")) continue;
    const abs = join(sshDir, name);
    let line = "";
    try {
      line = readFileSync(abs, "utf8").trim().split(/\r?\n/)[0]?.trim() ?? "";
    } catch {
      continue;
    }
    if (!line || !/^(ssh-|ecdsa-)/.test(line)) continue;

    if (name.endsWith("-cert.pub")) {
      const base = name.slice(0, -"-cert.pub".length);
      certByBase.set(base, abs);
      publicKeyLines.add(line);
      continue;
    }

    publicKeyLines.add(line);
  }

  /** @type {{ privateKey: string; certificateFile?: string }[]} */
  const identities = [];
  for (const name of files) {
    if (name.endsWith(".pub") || name.endsWith(".pub.old")) continue;
    if (name === "config" || name === "known_hosts" || name === "authorized_keys") continue;
    const priv = join(sshDir, name);
    if (!existsSync(priv)) continue;
    try {
      const st = readFileSync(priv);
      if (!st.length) continue;
    } catch {
      continue;
    }
    const cert = certByBase.get(name);
    identities.push(cert ? { privateKey: priv, certificateFile: cert } : { privateKey: priv });
  }

  return { publicKeyLines: [...publicKeyLines], identities };
}

/**
 * @param {string[]} keyLinesB64 base64-encoded public key lines
 */
export function remoteInstallAuthorizedKeysBash(keyLinesB64) {
  const parts = [
    "set -euo pipefail",
    'install -d -m 700 "$HOME/.ssh"',
    'touch "$HOME/.ssh/authorized_keys"',
    'chmod 600 "$HOME/.ssh/authorized_keys"',
  ];
  for (const b64 of keyLinesB64) {
    parts.push(
      `KEY=$(printf '%s' '${b64}' | base64 -d)`,
      'grep -qxF "$KEY" "$HOME/.ssh/authorized_keys" 2>/dev/null || printf "%s\\n" "$KEY" >> "$HOME/.ssh/authorized_keys"',
    );
  }
  return parts.join("; ");
}

/**
 * @param {string} password
 * @returns {{ path: string; env: Record<string, string>; cleanup: () => void }}
 */
export function createSshAskpassHelper(password) {
  const isWin = process.platform === "win32";
  const path = join(tmpdir(), `hdc-askpass-${process.pid}${isWin ? ".cmd" : ".sh"}`);
  const envKey = "HDC_SSH_ASKPASS_PW";
  if (isWin) {
    writeFileSync(path, `@echo off\r\n@echo %${envKey}%\r\n`, "utf8");
  } else {
    writeFileSync(path, `#!/bin/sh\nprintf '%s' "$${envKey}"\n`, "utf8");
    chmodSync(path, 0o700);
  }
  const cleanup = () => {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  };
  return {
    path,
    env: {
      [envKey]: password,
      SSH_ASKPASS: path,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: process.env.DISPLAY || ":0",
    },
    cleanup,
  };
}

/**
 * @param {{ user: string; host: string }} target
 * @param {object} opts
 * @param {"pubkey" | "password"} opts.mode
 * @param {{ privateKey: string; certificateFile?: string }[]} [opts.identities]
 * @param {Record<string, string>} [opts.extraEnv]
 * @param {boolean} [opts.batchMode]
 */
export function buildSshArgv(target, opts) {
  const { mode, identities = [], extraEnv, batchMode = mode === "pubkey" } = opts;
  const dest = `${target.user}@${target.host}`;
  /** @type {string[]} */
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
  ];
  if (batchMode) {
    args.push("-o", "BatchMode=yes");
  } else {
    args.push("-o", "BatchMode=no");
  }

  if (mode === "password") {
    args.push("-o", "PreferredAuthentications=password,keyboard-interactive");
    args.push("-o", "PubkeyAuthentication=no");
  } else {
    args.push("-o", "PreferredAuthentications=publickey");
    args.push("-o", "PasswordAuthentication=no");
    for (const id of identities) {
      args.push("-i", id.privateKey);
      if (id.certificateFile) {
        args.push("-o", `CertificateFile=${id.certificateFile}`);
      }
    }
  }

  args.push(dest);
  return { args, extraEnv: extraEnv ?? {} };
}

/**
 * Escape a string for a single-quoted POSIX shell argument.
 * @param {string} s
 */
export function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Remote argv for `bash -lc` with the script safely quoted for OpenSSH's `/bin/sh -c` wrapper.
 * @param {string} script
 * @returns {string[]}
 */
export function sshBashLcRemoteArgv(script) {
  return [`bash -lc ${shellSingleQuote(script)}`];
}

/**
 * @param {{ user: string; host: string }} target
 * @param {string} script
 * @param {object} opts
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {"pubkey" | "password"} opts.mode
 * @param {{ privateKey: string; certificateFile?: string }[]} [opts.identities]
 * @param {string} [opts.password]
 * @param {number} [opts.timeoutMs]
 */
export function sshBashLc(target, script, opts) {
  return sshSpawn(target, sshBashLcRemoteArgv(script), opts);
}

/**
 * @param {{ user: string; host: string }} target
 * @param {string[]} remoteArgv
 * @param {object} opts
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {"pubkey" | "password"} opts.mode
 * @param {{ privateKey: string; certificateFile?: string }[]} [opts.identities]
 * @param {string} [opts.password]
 * @param {number} [opts.timeoutMs]
 */
export function sshSpawn(target, remoteArgv, opts) {
  const { spawnSync, env, mode, identities = [], password, timeoutMs = 120_000 } = opts;
  let askpass = null;
  /** @type {NodeJS.ProcessEnv} */
  let childEnv = { ...env };

  if (mode === "password" && password) {
    askpass = createSshAskpassHelper(password);
    childEnv = { ...childEnv, ...askpass.env };
  }

  const { args, extraEnv } = buildSshArgv(target, {
    mode,
    identities,
    batchMode: mode === "pubkey",
    extraEnv: askpass?.env,
  });
  const fullArgs = [...args, ...remoteArgv];

  try {
    return spawnSync("ssh", fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...childEnv, ...extraEnv },
      shell: false,
      timeout: timeoutMs,
      encoding: "utf8",
    });
  } finally {
    askpass?.cleanup();
  }
}

/**
 * @param {{ user: string; host: string }} target
 * @param {typeof import("node:child_process").spawnSync} spawnSync
 * @param {NodeJS.ProcessEnv} env
 * @param {{ privateKey: string; certificateFile?: string }[]} identities
 */
export function sshReachableWithPubkey(target, spawnSync, env, identities) {
  const r = sshSpawn(target, ["true"], {
    spawnSync,
    env,
    mode: "pubkey",
    identities,
    timeoutMs: 20_000,
  });
  return r.status === 0;
}

/**
 * @param {object} opts
 * @param {{ id: string; user: string; host: string }} opts.target
 * @param {string[]} opts.publicKeyLines
 * @param {{ privateKey: string; certificateFile?: string }[]} opts.identities
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {import("./vault-access.mjs").ReturnType<import("./vault-access.mjs").createVaultAccess>} opts.vault
 * @param {(line: string) => void} opts.log
 * @param {(line: string) => void} opts.warn
 * @param {(q: string, o?: { mask?: boolean }) => Promise<string>} opts.readLineQuestion
 * @param {boolean} [opts.dryRun]
 */
export async function ensureSshAuthorizedKeys(opts) {
  const { target, publicKeyLines, identities, spawnSync, env, vault, log, warn, readLineQuestion, dryRun = false } =
    opts;

  if (!publicKeyLines.length) {
    warn(`[${target.id}] no local SSH public keys found in ~/.ssh — skip key install.`);
    return { ok: false, pubkeyAuth: false };
  }

  if (!dryRun && sshReachableWithPubkey(target, spawnSync, env, identities)) {
    log(`[${target.id}] SSH public-key auth OK for ${target.user}@${target.host}.`);
  } else if (!dryRun) {
    log(`[${target.id}] public-key auth failed — trying vault/password for ${target.user}@${target.host} …`);
  }

  const sshAuth = await resolveProxmoxSshPassword({
    target,
    vault,
    spawnSync,
    env,
    identities,
    readLineQuestion,
    warn,
    dryRun,
  });
  const password = sshAuth?.mode === "password" ? sshAuth.password : null;

  if (dryRun) {
    log(`[${target.id}] dry-run: would install ${publicKeyLines.length} SSH public key line(s) on ${target.user}@${target.host}.`);
    return { ok: true, pubkeyAuth: true };
  }

  if (!sshReachableWithPubkey(target, spawnSync, env, identities) && !password) {
    warn(`[${target.id}] cannot reach ${target.user}@${target.host} via SSH — skip key install.`);
    return { ok: false, pubkeyAuth: false };
  }

  const keyLinesB64 = publicKeyLines.map((line) => Buffer.from(line, "utf8").toString("base64"));
  const remote = remoteInstallAuthorizedKeysBash(keyLinesB64);
  log(`[${target.id}] installing ${publicKeyLines.length} SSH public key line(s) in authorized_keys …`);

  const install = sshReachableWithPubkey(target, spawnSync, env, identities)
    ? sshBashLc(target, remote, { spawnSync, env, mode: "pubkey", identities, timeoutMs: 60_000 })
    : sshBashLc(target, remote, {
        spawnSync,
        env,
        mode: "password",
        password: password ?? "",
        timeoutMs: 60_000,
      });

  if (install.status !== 0) {
    const err = `${install.stderr ?? ""}${install.stdout ?? ""}`.trim();
    warn(`[${target.id}] authorized_keys install failed: ${err || `status ${install.status ?? "?"}`}`);
    return { ok: false, pubkeyAuth: false };
  }

  if (!sshReachableWithPubkey(target, spawnSync, env, identities)) {
    warn(`[${target.id}] keys installed but public-key auth still fails — check remote sshd_config.`);
    return { ok: false, pubkeyAuth: false };
  }

  log(`[${target.id}] SSH public-key auth ready.`);
  return { ok: true, pubkeyAuth: true };
}

/**
 * Resolve SSH auth for a Proxmox hypervisor: pubkey first, then vault password, then prompt.
 * @param {object} opts
 * @param {{ id: string; user: string; host: string }} opts.target
 * @param {import("./vault-access.mjs").ReturnType<import("./vault-access.mjs").createVaultAccess>} opts.vault
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {{ privateKey: string; certificateFile?: string }[]} opts.identities
 * @param {(q: string, o?: { mask?: boolean }) => Promise<string>} opts.readLineQuestion
 * @param {(line: string) => void} opts.warn
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ mode: "pubkey" | "password"; password: string | null } | null>}
 */
export async function resolveProxmoxSshPassword(opts) {
  const { target, vault, spawnSync, env, identities, readLineQuestion, warn, dryRun = false } = opts;

  if (!dryRun && sshReachableWithPubkey(target, spawnSync, env, identities)) {
    return { mode: "pubkey", password: null };
  }

  const vaultKey = vaultKeyForProxmoxSshPassword(target.id);
  /** @type {string | null} */
  let password = null;
  if (!dryRun) {
    const data = (await vault.readSecrets({})) ?? {};
    const stored = typeof data[vaultKey] === "string" ? data[vaultKey].trim() : "";
    if (stored && sshReachableWithPassword(target, spawnSync, env, stored)) {
      password = stored;
    } else if (stored) {
      warn(`[${target.id}] stored vault password for ${vaultKey} did not work — will prompt.`);
    }
  }

  if (!dryRun && !password) {
    password = await promptAndStoreSshPassword({
      target,
      vaultKey,
      vault,
      spawnSync,
      env,
      readLineQuestion,
      warn,
    });
  }

  if (dryRun) {
    return { mode: "pubkey", password: null };
  }

  if (!password) return null;
  return { mode: "password", password };
}

/**
 * @param {{ user: string; host: string }} target
 * @param {typeof import("node:child_process").spawnSync} spawnSync
 * @param {NodeJS.ProcessEnv} env
 * @param {string} password
 */
function sshReachableWithPassword(target, spawnSync, env, password) {
  const r = sshSpawn(target, ["true"], {
    spawnSync,
    env,
    mode: "password",
    password,
    timeoutMs: 25_000,
  });
  return r.status === 0;
}

/**
 * @param {object} opts
 */
async function promptAndStoreSshPassword(opts) {
  const { target, vaultKey, vault, spawnSync, env, readLineQuestion, warn } = opts;
  const label = `SSH password for ${target.user}@${target.host} (${target.id})`;
  for (;;) {
    const value = await readLineQuestion(`${label}: `, { mask: true });
    if (!value.trim()) {
      warn("Empty password; try again or Ctrl+C to abort.");
      continue;
    }
    if (!sshReachableWithPassword(target, spawnSync, env, value.trim())) {
      warn(`[${target.id}] password verification failed for ${target.user}@${target.host}.`);
      continue;
    }
    await vault.setSecret(vaultKey, value.trim());
    return value.trim();
  }
}
