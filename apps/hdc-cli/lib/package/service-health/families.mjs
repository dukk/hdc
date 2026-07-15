/**
 * Default HTTP health paths keyed by package id.
 * @type {Record<string, string>}
 */
export const HEALTH_PATHS = {
  vaultwarden: "/alive",
  n8n: "/healthz",
  listmonk: "/api/health",
  shlink: "/rest/health",
  paperclip: "/api/health",
  vikunja: "/api/v1/info",
  "open-webui": "/",
  "uptime-kuma": "/",
  keycloak: "/health/ready",
  litellm: "/health/liveliness",
  vllm: "/health",
  "hdc-agents": "/health",
  "hdc-web": "/",
  "a2a-registry": "/health",
  twenty: "/healthz",
  homepage: "/",
  gatus: "/",
  immich: "/api/server/ping",
  "stirling-pdf": "/api/v1/info/status",
  meshcentral: "/",
  "nginx-waf": "/",
  nginx: "/",
  searxng: "/",
  yacy: "/",
  wallos: "/",
  memos: "/",
  "it-tools": "/",
  "omni-tools": "/",
  openspeedtest: "/",
  rackula: "/",
  paperlessngx: "/",
  "paperless-ngx": "/",
  solidtime: "/",
  postiz: "/",
  nextcloud: "/",
  plex: "/identity",
  homeassistant: "/",
  wazuh: "/",
  crowdsec: "/",
  greenbone: "/",
  affine: "/",
};

/**
 * Default listen ports when config lacks host_port.
 * @type {Record<string, number>}
 */
export const DEFAULT_PORTS = {
  vaultwarden: 80,
  n8n: 5678,
  listmonk: 9000,
  shlink: 8080,
  paperclip: 3100,
  vikunja: 3456,
  "open-webui": 3000,
  "uptime-kuma": 3001,
  keycloak: 8080,
  litellm: 4000,
  vllm: 8000,
  "hdc-agents": 9200,
  "hdc-web": 9120,
  homepage: 3000,
  gatus: 8080,
  searxng: 8080,
  yacy: 8090,
  wallos: 8282,
  memos: 5230,
  "it-tools": 8080,
  "omni-tools": 8080,
  openspeedtest: 3000,
  rackula: 8080,
  "paperless-ngx": 8000,
  "stirling-pdf": 8080,
  meshcentral: 4430,
  immich: 2283,
  nginx: 80,
  "nginx-waf": 443,
};

/**
 * Family defaults for scaffolding / thin health/run.mjs.
 * @type {Record<string, "docker-lxc"|"docker-qemu"|"qemu-native"|"synology"|"infra-api"|"client"|"self-edge">}
 */
export const PACKAGE_FAMILIES = {
  vaultwarden: "docker-lxc",
  n8n: "docker-lxc",
  homepage: "docker-lxc",
  keycloak: "docker-lxc",
  "nginx-waf": "self-edge",
  nginx: "self-edge",
  cloudflare: "infra-api",
  "cloudflare-workers": "infra-api",
  discord: "infra-api",
  twilio: "infra-api",
  openrouter: "infra-api",
  smtp2go: "infra-api",
  uptimerobot: "infra-api",
  "gcp-oauth": "infra-api",
  azure: "infra-api",
  "gcp-compute": "infra-api",
  "oci-compute": "infra-api",
  aws: "infra-api",
  "unifi-network": "infra-api",
  windows: "client",
  ubuntu: "client",
  "client-ubuntu": "client",
  raspberrypi: "client",
  plex: "synology",
  immich: "synology",
  "synology-nas": "synology",
};

/**
 * @param {string} packageId
 * @param {string} [familyOverride]
 */
export function resolveFamily(packageId, familyOverride) {
  if (familyOverride) return familyOverride;
  if (PACKAGE_FAMILIES[packageId]) return PACKAGE_FAMILIES[packageId];
  return "docker-lxc";
}
