import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { rsyncToRemote } from "./hdc-runner-sync.mjs";

/**
 * Relative paths under hdc public root to sync as the agent bundle.
 *
 * @param {string} publicRoot
 */
export function collectAgentBundlePaths(publicRoot) {
  /** @type {string[]} */
  const paths = [];
  const root = publicRoot.replace(/\\/g, "/");

  const agentsDir = join(root, ".cursor", "agents");
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir)) {
      if (name.startsWith("hdc-") && name.endsWith(".md")) {
        paths.push(join(".cursor", "agents", name).replace(/\\/g, "/"));
      }
    }
  }

  const skillsDir = join(root, ".cursor", "skills");
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      if (!name.startsWith("hdc-")) continue;
      const p = join(skillsDir, name);
      if (statSync(p).isDirectory()) {
        paths.push(join(".cursor", "skills", name).replace(/\\/g, "/"));
      }
    }
  }

  const autoDir = join(root, ".cursor", "automations");
  if (existsSync(autoDir)) {
    for (const name of readdirSync(autoDir)) {
      if (name.endsWith(".md")) {
        paths.push(join(".cursor", "automations", name).replace(/\\/g, "/"));
      }
    }
  }

  return paths;
}

/**
 * Sync agent bundle paths to guest install_root/.cursor/…
 *
 * @param {object} opts
 * @param {string} opts.publicRoot
 * @param {string} opts.remoteUser
 * @param {string} opts.remoteHost
 * @param {number} [opts.remotePort]
 * @param {string} opts.installRoot
 * @param {boolean} [opts.dryRun]
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 */
export function syncAgentBundleToGuest(opts) {
  const paths = collectAgentBundlePaths(opts.publicRoot);
  if (!paths.length) {
    opts.log.warn?.("agent bundle: no files found under .cursor/");
    return { ok: true, skipped: true, message: "no agent bundle files", paths: [] };
  }

  const remoteBase = `${opts.remoteUser}@${opts.remoteHost}`;
  const port = opts.remotePort ?? 22;
  const installRoot = opts.installRoot.replace(/\/$/, "");
  /** @type {{ path: string; ok: boolean; message: string }[]} */
  const results = [];

  for (const rel of paths) {
    const localFull = join(opts.publicRoot, rel).replace(/\\/g, "/");
    if (!existsSync(localFull)) continue;

    const isDir = statSync(localFull).isDirectory();
    let localRoot;
    let remoteDest;
    if (isDir) {
      localRoot = localFull.endsWith("/") ? localFull : `${localFull}/`;
      remoteDest = `${remoteBase}:${installRoot}/${rel}/`;
    } else {
      const parent = rel.slice(0, rel.lastIndexOf("/"));
      localRoot = join(opts.publicRoot, parent).replace(/\\/g, "/");
      localRoot = localRoot.endsWith("/") ? localRoot : `${localRoot}/`;
      remoteDest = `${remoteBase}:${installRoot}/${parent}/`;
    }

    opts.log.info(`agent bundle: ${rel} → ${remoteDest}`);
    const r = rsyncToRemote({
      localRoot: isDir ? localRoot : localRoot,
      remoteDest,
      exclude: [],
      dryRun: opts.dryRun,
      delete: isDir,
      port,
    });

    results.push({ path: rel, ok: r.ok, message: r.message });
    if (!r.ok) return { ok: false, message: r.message, paths, results };
  }

  return { ok: true, message: `synced ${paths.length} path(s)`, paths, results };
}

/**
 * Ensure guest directories for agent tasks and logs.
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export function ensureAgentGuestDirectories(exec, runner) {
  const script = [
    "set -e",
    `mkdir -p '${runner.private_root}/operations/tasks' '${runner.private_root}/operations/reports'`,
    `mkdir -p '${runner.install_root}/.cursor/agents' '${runner.install_root}/.cursor/skills' '${runner.install_root}/.cursor/automations'`,
    "mkdir -p /var/log/hdc-runner/agents",
    `chown -R hdc:hdc '${runner.private_root}/operations' /var/log/hdc-runner 2>/dev/null || true`,
    `chown -R hdc:hdc '${runner.install_root}/.cursor' 2>/dev/null || true`,
  ].join("\n");
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    return { ok: false, message: `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}` };
  }
  return { ok: true, message: "agent directories ready" };
}

export function cursorAgentInstallScript() {
  return [
    "set -e",
    "if ! command -v agent >/dev/null 2>&1; then",
    "  curl -fsSL https://cursor.com/install | bash",
    "fi",
    "export PATH=\"$HOME/.local/bin:/usr/local/bin:$PATH\"",
    "command -v agent >/dev/null 2>&1 || { echo 'cursor agent CLI not found after install' >&2; exit 1; }",
    "agent --version 2>/dev/null || agent about 2>/dev/null || true",
  ].join("\n");
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {{ info: (msg: string) => void }} log
 */
export function ensureCursorCliOnGuest(exec, log) {
  log.info(`${exec.label}: ensuring Cursor CLI (agent)`);
  const r = exec.run(cursorAgentInstallScript(), { capture: true });
  if (r.status !== 0) {
    return { ok: false, message: `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}` };
  }
  return { ok: true, message: "cursor cli ready" };
}
