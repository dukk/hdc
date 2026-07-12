import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { posixPath } from "./posix-path.mjs";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SOURCE = join(LIB_DIR, "..", "..", "paperclip", "lib", "paperclip-agent-bridge.mjs");

/**
 * Resolve bridge script source (hdc-runner maintain syncs paperclip package).
 */
function bridgeSourcePath(installRoot) {
  const synced = join(installRoot, "clumps/services/paperclip/lib/paperclip-agent-bridge.mjs");
  try {
    readFileSync(synced, "utf8");
    return synced;
  } catch {
    return BRIDGE_SOURCE;
  }
}

/**
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizePaperclipBridgeBlock>} bridge
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export function renderPaperclipBridgeSystemdUnit(bridge, runner) {
  const installRoot = runner.install_root;
  const metaRoot = runner.meta_root;
  const bridgePath = posixPath(
    join(installRoot, "clumps/services/paperclip/lib/paperclip-agent-bridge.mjs"),
  );
  return [
    "[Unit]",
    "Description=HDC Paperclip agent bridge",
    "After=network.target hdc-runner-ui.service",
    "",
    "[Service]",
    "Type=simple",
    "User=hdc",
    "Group=hdc",
    `EnvironmentFile=${metaRoot}/.env`,
    `Environment=HDC_RUNNER_BRIDGE_HOST=${bridge.host}`,
    `Environment=HDC_RUNNER_BRIDGE_PORT=${bridge.port}`,
    `Environment=HDC_RUNNER_BRIDGE_URL=${bridge.hdc_runner_url}`,
    `ExecStart=/usr/bin/node ${bridgePath}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

/**
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ skipBridge?: boolean }} [opts]
 * @returns {string[]}
 */
export function buildPaperclipBridgeDeployParts(runner, opts = {}) {
  const bridge = runner.paperclip_bridge;
  if (!bridge?.enabled || opts.skipBridge) {
    return ["systemctl disable --now hdc-paperclip-bridge 2>/dev/null || true"];
  }

  const meta = runner.meta_root;
  const sourcePath = bridgeSourcePath(runner.install_root);
  const body = readFileSync(sourcePath, "utf8");
  const unit = renderPaperclipBridgeSystemdUnit(bridge, runner);
  const dest = posixPath(
    join(runner.install_root, "clumps/services/paperclip/lib/paperclip-agent-bridge.mjs"),
  );

  return [
    `mkdir -p '${dirname(dest)}'`,
    `cat > '${dest}' <<'HDC_PAPERCLIP_BRIDGE_EOF'`,
    body,
    "HDC_PAPERCLIP_BRIDGE_EOF",
    `chown hdc:hdc '${dest}' 2>/dev/null || true`,
    `cat > /etc/systemd/system/hdc-paperclip-bridge.service <<'HDC_PAPERCLIP_BRIDGE_UNIT_EOF'`,
    unit,
    "HDC_PAPERCLIP_BRIDGE_UNIT_EOF",
    "systemctl daemon-reload",
    "systemctl enable hdc-paperclip-bridge",
    "systemctl restart hdc-paperclip-bridge",
    "sleep 2",
    "systemctl is-active --quiet hdc-paperclip-bridge",
  ];
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ skipBridge?: boolean }} [opts]
 */
export function configurePaperclipBridgeOnGuest(exec, runner, opts = {}) {
  const parts = buildPaperclipBridgeDeployParts(runner, opts);
  if (parts.length === 0) {
    return { ok: true, enabled: false, message: "bridge disabled" };
  }
  const r = exec.run(parts.join("\n"), { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, enabled: runner.paperclip_bridge?.enabled === true, message: detail };
  }
  const port = runner.paperclip_bridge?.port ?? 9121;
  const healthRun = exec.run(`curl -sf -m 5 http://127.0.0.1:${port}/api/health >/dev/null`, {
    capture: true,
  });
  if (healthRun.status !== 0) {
    const journal = exec.run("journalctl -u hdc-paperclip-bridge -n 15 --no-pager 2>/dev/null || true", {
      capture: true,
    });
    const detail = `${journal.stdout}${journal.stderr}`.trim() || "hdc-paperclip-bridge not healthy after restart";
    return { ok: false, enabled: runner.paperclip_bridge?.enabled === true, port, message: detail };
  }
  return {
    ok: true,
    enabled: runner.paperclip_bridge?.enabled === true,
    port,
    message: "paperclip bridge configured",
  };
}
