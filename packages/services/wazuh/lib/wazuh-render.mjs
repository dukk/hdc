import { wazuhDashboardPort } from "./deployments.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} install
 */
export function composeDir(install) {
  return typeof install.compose_dir === "string" && install.compose_dir.trim()
    ? install.compose_dir.trim()
    : "/opt/wazuh";
}

/**
 * @param {Record<string, unknown>} install
 */
export function wazuhStackDir(install) {
  return `${composeDir(install)}/wazuh-docker/single-node`;
}

/**
 * @param {Record<string, unknown>} wazuh
 */
export function wazuhDockerRelease(wazuh) {
  const raw = typeof wazuh.release === "string" && wazuh.release.trim() ? wazuh.release.trim() : "4.10.3";
  return raw.replace(/^v/i, "");
}

/**
 * @param {Record<string, unknown>} wazuh
 * @param {string} apiPassword
 * @param {string} agentPassword
 */
export function renderWazuhEnv(wazuh, apiPassword, agentPassword) {
  const release = wazuhDockerRelease(wazuh);
  const dashboardPort = wazuhDashboardPort(wazuh);
  const lines = [
    `WAZUH_RELEASE=${release}`,
    `WAZUH_API_PASSWORD=${apiPassword}`,
    `WAZUH_AGENT_PASSWORD=${agentPassword}`,
    `WAZUH_DASHBOARD_PORT=${dashboardPort}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** Bash fragment: patch compose + wazuh.yml API credentials (expects STACK, WAZUH_API_PASSWORD). */
export function wazuhStackApiCredentialsPatchBash() {
  return [
    "python3 - <<'PY'",
    "from pathlib import Path",
    "import os",
    "import re",
    "stack = Path(os.environ['STACK'])",
    "api_pw = os.environ['WAZUH_API_PASSWORD']",
    "compose = stack / 'docker-compose.yml'",
    "text = compose.read_text()",
    "text = text.replace('SecretPassword', api_pw)",
    "text = text.replace('MyS3cr37P450r.*-', api_pw)",
    "text = re.sub(r'(DASHBOARD_PASSWORD=)kibanaserver', r'\\1' + api_pw, text)",
    "compose.write_text(text)",
    "wazuh_yml = stack / 'config' / 'wazuh_dashboard' / 'wazuh.yml'",
    "if wazuh_yml.is_file():",
    "  yml_text = wazuh_yml.read_text()",
    "  yml_text = re.sub(r'(password:\\s*)\"[^\"]*\"', r'\\1\"' + api_pw.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"') + '\"', yml_text, count=1)",
    "  wazuh_yml.write_text(yml_text)",
    "PY",
  ].join("\n");
}

/**
 * Re-hash indexer internal_users.yml from WAZUH_API_PASSWORD and apply via securityadmin.
 * Expects STACK, WAZUH_API_PASSWORD, WAZUH_RELEASE (optional).
 */
export function wazuhIndexerPasswordResyncBash() {
  return [
    "python3 - <<'PY'",
    "from pathlib import Path",
    "import os",
    "import re",
    "import subprocess",
    "stack = Path(os.environ['STACK'])",
    "api_pw = os.environ['WAZUH_API_PASSWORD']",
    "release = os.environ.get('WAZUH_RELEASE', '4.10.3').strip() or '4.10.3'",
    "hash_out = subprocess.check_output([",
    "  'docker', 'run', '--rm', f'wazuh/wazuh-indexer:{release}',",
    "  '/usr/share/wazuh-indexer/plugins/opensearch-security/tools/hash.sh',",
    "  '-p', api_pw,",
    "], text=True)",
    "pw_hash = hash_out.strip().splitlines()[-1]",
    "users = stack / 'config' / 'wazuh_indexer' / 'internal_users.yml'",
    "if not users.is_file():",
    "  raise SystemExit('missing internal_users.yml')",
    "user_text = users.read_text()",
    "for user in ('admin', 'kibanaserver'):",
    "  user_text = re.sub(rf'({user}:\\n  hash: )\"[^\"]+\"', rf'\\1\"{pw_hash}\"', user_text)",
    "users.write_text(user_text)",
    "print('indexer internal_users password hash refreshed')",
    "PY",
    "docker exec -u root single-node-wazuh.indexer-1 bash -c '",
    "  export JAVA_HOME=/usr/share/wazuh-indexer/jdk",
    "  /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh \\",
    "    -cd /usr/share/wazuh-indexer/opensearch-security/ \\",
    "    -icl -nhnv \\",
    "    -cacert /usr/share/wazuh-indexer/certs/root-ca.pem \\",
    "    -cert /usr/share/wazuh-indexer/certs/admin.pem \\",
    "    -key /usr/share/wazuh-indexer/certs/admin-key.pem \\",
    "    -h wazuh.indexer",
    "' || true",
    "docker compose restart wazuh.indexer",
    "for i in $(seq 1 30); do curl -sk -u \"admin:$WAZUH_API_PASSWORD\" https://127.0.0.1:9200/ >/dev/null 2>&1 && break; sleep 5; done",
  ].join("\n");
}

/** Restart API-facing services after wazuh.yml / compose credential patch. */
export function wazuhDashboardApiConfigSyncBash() {
  return [
    'if test -f config/wazuh_dashboard/wazuh.yml; then',
    "  docker compose restart wazuh.dashboard wazuh.manager",
    "fi",
  ].join("\n");
}

/**
 * @param {string} release
 * @param {string} apiPassword
 * @param {string} agentPassword
 * @param {number} dashboardPort
 */
export function buildOfficialStackInstallScript(release, apiPassword, agentPassword, dashboardPort) {
  const tag = release.replace(/^v/i, "");
  const gitTag = tag.startsWith("v") ? tag : `v${tag}`;
  return [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq ca-certificates curl gnupg git",
    "if ! command -v docker >/dev/null 2>&1; then",
    "  install -m 0755 -d /etc/apt/keyrings",
    "  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
    "  chmod a+r /etc/apt/keyrings/docker.asc",
    '  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${VERSION_CODENAME:-$VERSION_ID}) stable" > /etc/apt/sources.list.d/docker.list',
    "  apt-get update -qq",
    "  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin",
    "fi",
    "systemctl enable --now docker",
    `export WAZUH_RELEASE='${tag.replace(/'/g, `'\\''`)}'`,
    `export WAZUH_GIT_TAG='${gitTag.replace(/'/g, `'\\''`)}'`,
    `export WAZUH_ROOT='${composeDir({}).replace(/'/g, `'\\''`)}'`,
    `export WAZUH_API_PASSWORD='${apiPassword.replace(/'/g, `'\\''`)}'`,
    `export WAZUH_AGENT_PASSWORD='${agentPassword.replace(/'/g, `'\\''`)}'`,
    `export WAZUH_DASHBOARD_PORT='${dashboardPort}'`,
    'mkdir -p "$WAZUH_ROOT"',
    'if test -d "$WAZUH_ROOT/wazuh-docker/.git"; then',
    '  git -C "$WAZUH_ROOT/wazuh-docker" fetch --depth 1 origin "refs/tags/$WAZUH_GIT_TAG"',
    '  git -C "$WAZUH_ROOT/wazuh-docker" checkout -f "$WAZUH_GIT_TAG"',
    '  git -C "$WAZUH_ROOT/wazuh-docker" reset --hard "$WAZUH_GIT_TAG"',
    "else",
    '  rm -rf "$WAZUH_ROOT/wazuh-docker"',
    '  git clone --depth 1 --branch "$WAZUH_GIT_TAG" https://github.com/wazuh/wazuh-docker.git "$WAZUH_ROOT/wazuh-docker"',
    "fi",
    'if test -f "$WAZUH_ROOT/docker-compose.yml"; then',
    '  (cd "$WAZUH_ROOT" && docker compose down -v 2>/dev/null) || true',
    "fi",
    'STACK="$WAZUH_ROOT/wazuh-docker/single-node"',
    'export STACK',
    'if test -f "$STACK/docker-compose.yml"; then',
    '  (cd "$STACK" && docker compose down -v 2>/dev/null) || true',
    "fi",
    'cd "$STACK"',
    "python3 - <<'PY'",
    "from pathlib import Path",
    "import os",
    "import re",
    "import subprocess",
    "stack = Path(os.environ['STACK'])",
    "api_pw = os.environ['WAZUH_API_PASSWORD']",
    "release = os.environ['WAZUH_RELEASE']",
    "compose = stack / 'docker-compose.yml'",
    "text = compose.read_text()",
    "text = text.replace('SecretPassword', api_pw)",
    "text = text.replace('MyS3cr37P450r.*-', api_pw)",
    "text = re.sub(r'(DASHBOARD_PASSWORD=)kibanaserver', r'\\1' + api_pw, text)",
    "port = os.environ.get('WAZUH_DASHBOARD_PORT', '443')",
    "text = text.replace('443:5601', f'{port}:5601')",
    "compose.write_text(text)",
    "wazuh_yml = stack / 'config' / 'wazuh_dashboard' / 'wazuh.yml'",
    "if wazuh_yml.is_file():",
    "  yml_text = wazuh_yml.read_text()",
    "  yml_text = re.sub(r'(password:\\s*)\"[^\"]*\"', r'\\1\"' + api_pw.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"') + '\"', yml_text, count=1)",
    "  wazuh_yml.write_text(yml_text)",
    "hash_out = subprocess.check_output([",
    "  'docker', 'run', '--rm', f'wazuh/wazuh-indexer:{release}',",
    "  '/usr/share/wazuh-indexer/plugins/opensearch-security/tools/hash.sh',",
    "  '-p', api_pw,",
    "], text=True)",
    "pw_hash = hash_out.strip().splitlines()[-1]",
    "users = stack / 'config' / 'wazuh_indexer' / 'internal_users.yml'",
    "user_text = users.read_text()",
    "for user in ('admin', 'kibanaserver'):",
    "  user_text = re.sub(rf'({user}:\\n  hash: )\"[^\"]+\"', rf'\\1\"{pw_hash}\"', user_text)",
    "users.write_text(user_text)",
    "PY",
    'test -f config/wazuh_indexer_ssl_certs/admin.pem || docker compose -f generate-indexer-certs.yml run --rm generator',
    "docker compose pull",
    "docker compose up -d",
    'for i in $(seq 1 60); do curl -sk -u "admin:$WAZUH_API_PASSWORD" https://127.0.0.1:9200/ >/dev/null 2>&1 && break; sleep 5; done',
    "docker exec -u root single-node-wazuh.indexer-1 bash -c '",
    "  export JAVA_HOME=/usr/share/wazuh-indexer/jdk",
    "  /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh \\",
    "    -cd /usr/share/wazuh-indexer/opensearch-security/ \\",
    "    -icl -nhnv \\",
    "    -cacert /usr/share/wazuh-indexer/certs/root-ca.pem \\",
    "    -cert /usr/share/wazuh-indexer/certs/admin.pem \\",
    "    -key /usr/share/wazuh-indexer/certs/admin-key.pem \\",
    "    -h wazuh.indexer",
    "' || true",
    "docker compose ps",
  ].join("\n");
}

/**
 * @param {Record<string, unknown>} wazuh
 * @param {string | null} ctIp
 */
export function resolveDashboardUrl(wazuh, ctIp) {
  const configured =
    isObject(wazuh) && typeof wazuh.public_url === "string" && wazuh.public_url.trim()
      ? wazuh.public_url.trim()
      : null;
  if (configured) return configured;
  const port = wazuhDashboardPort(isObject(wazuh) ? wazuh : {});
  if (ctIp) return `https://${ctIp}:${port}`;
  return null;
}
