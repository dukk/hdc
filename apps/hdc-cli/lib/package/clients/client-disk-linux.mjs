import {
  discoverLocalSshMaterial,
  sshSpawn,
} from "../../ssh-host-access.mjs";

/**
 * @param {{ user: string; host: string }} target
 * @param {typeof import("node:child_process").spawnSync} spawnSync
 * @param {NodeJS.ProcessEnv} env
 */
export function queryLinuxDisk(target, spawnSync, env) {
  const { identities } = discoverLocalSshMaterial();
  const r = sshSpawn(target, ["bash", "-lc", "df -hP / 2>/dev/null | tail -1"], {
    spawnSync,
    env,
    mode: "pubkey",
    identities,
    timeoutMs: 60_000,
  });
  const line = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0, df_root: line };
}

/**
 * @param {{ user: string; host: string }} target
 * @param {typeof import("node:child_process").spawnSync} spawnSync
 * @param {NodeJS.ProcessEnv} env
 */
export function queryLinuxUpgradableCount(target, spawnSync, env) {
  const { identities } = discoverLocalSshMaterial();
  const r = sshSpawn(
    target,
    ["bash", "-lc", "apt-get update -qq >/dev/null 2>&1; apt list --upgradable 2>/dev/null | tail -n +2 | wc -l"],
    { spawnSync, env, mode: "pubkey", identities, timeoutMs: 300_000 },
  );
  const n = parseInt(`${r.stdout ?? ""}`.trim(), 10);
  return { ok: r.status === 0, upgradable_count: Number.isFinite(n) ? n : null };
}
