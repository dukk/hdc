import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWebConfigJson } from "./hdc-runner-settings.mjs";
import { posixPath } from "./posix-path.mjs";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_SOURCE = join(LIB_DIR, "..", "web");
const ADHOC_JOB_SOURCE = join(LIB_DIR, "run-adhoc-job.mjs");

/**
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export function renderSystemdUiUnit(runner) {
  const installRoot = runner.install_root;
  const metaRoot = runner.meta_root;
  const serverPath = posixPath(
    join(installRoot, "clumps/services/hdc-runner/lib/hdc-runner-ui-server.mjs"),
  );
  return [
    "[Unit]",
    "Description=HDC Runner Web UI",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "User=hdc",
    "Group=hdc",
    `EnvironmentFile=${metaRoot}/.env`,
    `Environment=HDC_RUNNER_META_ROOT=${metaRoot}`,
    `Environment=HDC_RUNNER_INSTALL_ROOT=${installRoot}`,
    `Environment=HDC_RUNNER_PRIVATE_ROOT=${runner.private_root}`,
    `ExecStart=/usr/bin/node ${serverPath}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

/**
 * Shell fragments to deploy web UI assets and systemd unit.
 *
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ skipUi?: boolean }} [opts]
 * @returns {string[]}
 */
export function buildWebUiDeployScriptParts(runner, opts = {}) {
  if (runner.web.enabled === false) {
    return ["systemctl disable --now hdc-runner-ui 2>/dev/null || true"];
  }
  if (opts.skipUi) {
    return [];
  }

  const meta = runner.meta_root;
  const installRoot = runner.install_root;
  const webConfig = buildWebConfigJson(runner.web);
  const adhocBody = readFileSync(ADHOC_JOB_SOURCE, "utf8");
  const systemdUnit = renderSystemdUiUnit(runner);

  /** @type {string[]} */
  const parts = [
    `mkdir -p '${meta}/web' '${meta}/bin'`,
    `rm -rf '${meta}/web'/*`,
  ];

  for (const name of ["index.html", "app.css", "app.js"]) {
    const body = readFileSync(join(WEB_SOURCE, name), "utf8");
    parts.push(
      `cat > '${meta}/web/${name}' <<'HDC_RUNNER_WEB_${name.toUpperCase().replace(".", "_")}_EOF'`,
      body,
      `HDC_RUNNER_WEB_${name.toUpperCase().replace(".", "_")}_EOF`,
    );
  }

  parts.push(
    `cat > '${meta}/web-config.json' <<'HDC_RUNNER_WEB_CFG_EOF'`,
    webConfig,
    "HDC_RUNNER_WEB_CFG_EOF",
    `chown hdc:hdc '${meta}/web-config.json' '${meta}/web' '${meta}/web/'* 2>/dev/null || true`,
    `cat > '${meta}/bin/run-adhoc-job.mjs' <<'HDC_RUNNER_ADHOC_EOF'`,
    adhocBody,
    "HDC_RUNNER_ADHOC_EOF",
    `chmod 755 '${meta}/bin/run-adhoc-job.mjs'`,
    `chown hdc:hdc '${meta}/bin/run-adhoc-job.mjs' 2>/dev/null || true`,
    `mkdir -p '${meta}/jobs'`,
    `chown hdc:hdc '${meta}/jobs' 2>/dev/null || true`,
    `cat > /etc/systemd/system/hdc-runner-ui.service <<'HDC_RUNNER_UI_UNIT_EOF'`,
    systemdUnit,
    "HDC_RUNNER_UI_UNIT_EOF",
    "systemctl daemon-reload",
    "systemctl enable hdc-runner-ui",
    "systemctl restart hdc-runner-ui",
    "sleep 2",
    "systemctl is-active --quiet hdc-runner-ui",
  );

  return parts;
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ skipUi?: boolean }} [opts]
 */
export function configureWebUiOnGuest(exec, runner, opts = {}) {
  const parts = buildWebUiDeployScriptParts(runner, opts);
  if (parts.length === 0) {
    return {
      ok: true,
      message: opts.skipUi ? "web UI skipped by flag" : "web UI disabled",
      enabled: runner.web.enabled !== false && !opts.skipUi,
      skipped: opts.skipUi === true,
      port: runner.web.port,
    };
  }
  const r = exec.run(parts.join("\n"), { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    return { ok: false, message: detail, enabled: runner.web.enabled !== false && !opts.skipUi };
  }
  const port = runner.web.port ?? 9120;
  const healthRun = exec.run(
    `curl -sf -m 5 http://127.0.0.1:${port}/api/health >/dev/null`,
    { capture: true },
  );
  if (healthRun.status !== 0) {
    const journal = exec.run("journalctl -u hdc-runner-ui -n 15 --no-pager 2>/dev/null || true", {
      capture: true,
    });
    const detail = `${journal.stdout}${journal.stderr}`.trim() || "hdc-runner-ui not healthy after restart";
    return { ok: false, message: detail, enabled: true, port };
  }
  return {
    ok: true,
    message: "web UI configured",
    enabled: true,
    port,
  };
}
