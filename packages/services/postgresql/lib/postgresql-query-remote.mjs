import { sshRemote } from "../../postfix-relay/lib/remote.mjs";

/**
 * @param {string} user
 * @param {string} host
 */
export function queryPostgresqlActive(user, host) {
  const r = sshRemote(user, host, "systemctl is-active postgresql 2>/dev/null || echo inactive", {
    capture: true,
  });
  const active = r.stdout.trim() === "active";
  return { active, status: r.stdout.trim() || "unknown", exit: r.status };
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryPgIsready(user, host) {
  const r = sshRemote(user, host, "sudo -u postgres pg_isready 2>/dev/null", { capture: true });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryPostgresqlVersion(user, host) {
  const r = sshRemote(
    user,
    host,
    "sudo -u postgres psql -tAc \"SELECT version();\" 2>/dev/null",
    { capture: true },
  );
  return { ok: r.status === 0, version: r.stdout.trim() };
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryRecoveryStatus(user, host) {
  const r = sshRemote(
    user,
    host,
    "sudo -u postgres psql -tAc \"SELECT pg_is_in_recovery();\" 2>/dev/null",
    { capture: true },
  );
  const val = r.stdout.trim();
  return {
    ok: r.status === 0,
    in_recovery: val === "t",
    raw: val,
  };
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryReplicationLag(user, host) {
  const r = sshRemote(
    user,
    host,
    "sudo -u postgres psql -tAc \"SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::bigint, -1);\" 2>/dev/null",
    { capture: true },
  );
  const lag = Number(r.stdout.trim());
  return {
    ok: r.status === 0,
    lag_seconds: Number.isFinite(lag) ? lag : null,
  };
}
