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
 * @param {Record<string, unknown>} wazuh
 * @param {string} apiPassword
 * @param {string} agentPassword
 */
export function renderWazuhEnv(wazuh, apiPassword, agentPassword) {
  const release = typeof wazuh.release === "string" && wazuh.release.trim() ? wazuh.release.trim() : "v4.9.0";
  const dashboardPort = wazuhDashboardPort(wazuh);
  const lines = [
    `WAZUH_RELEASE=${release}`,
    `WAZUH_API_PASSWORD=${apiPassword}`,
    `WAZUH_AGENT_PASSWORD=${agentPassword}`,
    `WAZUH_DASHBOARD_PORT=${dashboardPort}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderComposeYaml() {
  return `services:
  wazuh.manager:
    image: wazuh/wazuh-manager:\${WAZUH_RELEASE}
    container_name: wazuh.manager
    hostname: wazuh.manager
    restart: unless-stopped
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 131072
        hard: 131072
    ports:
      - "1514:1514"
      - "1515:1515"
      - "514:514/udp"
      - "55000:55000"
    environment:
      API_PASSWORD: "\${WAZUH_API_PASSWORD}"
      WAZUH_API_USER: "wazuh"
      WAZUH_API_PASSWORD: "\${WAZUH_API_PASSWORD}"
      WAZUH_AGENT_PASSWORD: "\${WAZUH_AGENT_PASSWORD}"
    volumes:
      - wazuh_api_configuration:/var/ossec/api/configuration
      - wazuh_etc:/var/ossec/etc
      - wazuh_logs:/var/ossec/logs
      - wazuh_queue:/var/ossec/queue
      - wazuh_var_multigroups:/var/ossec/var/multigroups
      - wazuh_integrations:/var/ossec/integrations
      - wazuh_active_response:/var/ossec/active-response/bin
      - wazuh_agentless:/var/ossec/agentless
      - wazuh_wodles:/var/ossec/wodles
      - wazuh_filebeat_etc:/etc/filebeat
      - wazuh_filebeat_var:/var/lib/filebeat

  wazuh.indexer:
    image: wazuh/wazuh-indexer:\${WAZUH_RELEASE}
    container_name: wazuh.indexer
    hostname: wazuh.indexer
    restart: unless-stopped
    ports:
      - "9200:9200"
    environment:
      "OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g"
    volumes:
      - wazuh-indexer-data:/var/lib/wazuh-indexer

  wazuh.dashboard:
    image: wazuh/wazuh-dashboard:\${WAZUH_RELEASE}
    container_name: wazuh.dashboard
    hostname: wazuh.dashboard
    restart: unless-stopped
    depends_on:
      - wazuh.indexer
    ports:
      - "\${WAZUH_DASHBOARD_PORT}:443"
    environment:
      OPENSEARCH_HOSTS: "https://wazuh.indexer:9200"

volumes:
  wazuh_api_configuration: {}
  wazuh_etc: {}
  wazuh_logs: {}
  wazuh_queue: {}
  wazuh_var_multigroups: {}
  wazuh_integrations: {}
  wazuh_active_response: {}
  wazuh_agentless: {}
  wazuh_wodles: {}
  wazuh_filebeat_etc: {}
  wazuh_filebeat_var: {}
  wazuh-indexer-data: {}
`;
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
