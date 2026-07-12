/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const DEFAULT_INSTALL_ROOT = "/opt/hdc";
const DEFAULT_PRIVATE_ROOT = "/opt/hdc-private";
const DEFAULT_META_ROOT = "/opt/hdc-runner";

const DEFAULT_WEB = {
  enabled: true,
  host: "0.0.0.0",
  port: 9120,
  username: "hdc",
  password_vault_key: "HDC_HDC_RUNNER_UI_PASSWORD",
  session_secret_vault_key: "HDC_HDC_RUNNER_UI_SESSION_SECRET",
  api_token_vault_key: "HDC_HDC_RUNNER_API_TOKEN",
  allowed_verbs: ["query", "maintain"],
  max_concurrent_jobs: 1,
  allowed_schedule_ids: [],
  allowed_packages: [],
};

const DEFAULT_PAPERCLIP_BRIDGE = {
  enabled: false,
  host: "0.0.0.0",
  port: 9121,
  secret_vault_key: "HDC_PAPERCLIP_AGENT_BRIDGE_SECRET",
  hdc_runner_url: "http://127.0.0.1:9120",
};

const DEFAULT_AGENTS = {
  enabled: true,
  cursor_api_key_vault_key: "HDC_CURSOR_API_KEY",
  workspace: DEFAULT_INSTALL_ROOT,
  private_root: DEFAULT_PRIVATE_ROOT,
  max_concurrent_agent_runs: 1,
  manager_schedule_id: "agent-manager-hourly",
};

/** Guest-authoritative paths excluded from operator → guest rsync delete/push */
export const GUEST_STATE_SYNC_EXCLUDES = [
  "operations/tasks/**",
  "operations/task-report.md",
];

/**
 * @param {unknown} bridgeBlock
 */
export function normalizePaperclipBridgeBlock(bridgeBlock) {
  const b = isObject(bridgeBlock) ? bridgeBlock : {};
  const port = Number(b.port);
  return {
    enabled: b.enabled === true,
    host: typeof b.host === "string" && b.host.trim() ? b.host.trim() : DEFAULT_PAPERCLIP_BRIDGE.host,
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : DEFAULT_PAPERCLIP_BRIDGE.port,
    secret_vault_key:
      typeof b.secret_vault_key === "string" && b.secret_vault_key.trim()
        ? b.secret_vault_key.trim()
        : DEFAULT_PAPERCLIP_BRIDGE.secret_vault_key,
    hdc_runner_url:
      typeof b.hdc_runner_url === "string" && b.hdc_runner_url.trim()
        ? b.hdc_runner_url.trim()
        : DEFAULT_PAPERCLIP_BRIDGE.hdc_runner_url,
  };
}

/**
 * @param {unknown} webBlock
 */
export function normalizeHdcRunnerWebBlock(webBlock) {
  const w = isObject(webBlock) ? webBlock : {};
  const allowedRaw = Array.isArray(w.allowed_verbs) ? w.allowed_verbs : DEFAULT_WEB.allowed_verbs;
  const allowed_verbs = allowedRaw.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  const maxJobs = Number(w.max_concurrent_jobs);
  return {
    enabled: w.enabled !== false,
    host: typeof w.host === "string" && w.host.trim() ? w.host.trim() : DEFAULT_WEB.host,
    port: Number.isFinite(Number(w.port)) && Number(w.port) > 0 ? Number(w.port) : DEFAULT_WEB.port,
    username:
      typeof w.username === "string" && w.username.trim() ? w.username.trim() : DEFAULT_WEB.username,
    password_vault_key:
      typeof w.password_vault_key === "string" && w.password_vault_key.trim()
        ? w.password_vault_key.trim()
        : DEFAULT_WEB.password_vault_key,
    session_secret_vault_key:
      typeof w.session_secret_vault_key === "string" && w.session_secret_vault_key.trim()
        ? w.session_secret_vault_key.trim()
        : DEFAULT_WEB.session_secret_vault_key,
    allowed_verbs: allowed_verbs.length > 0 ? allowed_verbs : [...DEFAULT_WEB.allowed_verbs],
    max_concurrent_jobs:
      Number.isFinite(maxJobs) && maxJobs > 0 ? Math.floor(maxJobs) : DEFAULT_WEB.max_concurrent_jobs,
    api_token_vault_key:
      typeof w.api_token_vault_key === "string" && w.api_token_vault_key.trim()
        ? w.api_token_vault_key.trim()
        : DEFAULT_WEB.api_token_vault_key,
    allowed_schedule_ids: Array.isArray(w.allowed_schedule_ids)
      ? w.allowed_schedule_ids.map((id) => String(id).trim()).filter(Boolean)
      : [...DEFAULT_WEB.allowed_schedule_ids],
    allowed_packages: Array.isArray(w.allowed_packages)
      ? w.allowed_packages
      : [...DEFAULT_WEB.allowed_packages],
  };
}

/** @param {ReturnType<typeof normalizeHdcRunnerWebBlock>} web */
export function uiPasswordVaultKey(web) {
  return web.password_vault_key;
}

/** @param {ReturnType<typeof normalizeHdcRunnerWebBlock>} web */
export function uiSessionSecretVaultKey(web) {
  return web.session_secret_vault_key;
}

/** @param {ReturnType<typeof normalizeHdcRunnerWebBlock>} web */
export function uiApiTokenVaultKey(web) {
  return web.api_token_vault_key;
}

/**
 * Non-secret web config pushed to guest as web-config.json.
 *
 * @param {ReturnType<typeof normalizeHdcRunnerWebBlock>} web
 */
export function buildWebConfigJson(web) {
  return JSON.stringify(
    {
      enabled: web.enabled,
      host: web.host,
      port: web.port,
      username: web.username,
      allowed_verbs: web.allowed_verbs,
      max_concurrent_jobs: web.max_concurrent_jobs,
      allowed_schedule_ids: web.allowed_schedule_ids,
      allowed_packages: web.allowed_packages,
    },
    null,
    2,
  );
}

/**
 * @param {unknown} agentsBlock
 */
export function normalizeHdcRunnerAgentsBlock(agentsBlock) {
  const a = isObject(agentsBlock) ? agentsBlock : {};
  const maxRuns = Number(a.max_concurrent_agent_runs);
  return {
    enabled: a.enabled !== false,
    cursor_api_key_vault_key:
      typeof a.cursor_api_key_vault_key === "string" && a.cursor_api_key_vault_key.trim()
        ? a.cursor_api_key_vault_key.trim()
        : DEFAULT_AGENTS.cursor_api_key_vault_key,
    workspace:
      typeof a.workspace === "string" && a.workspace.trim()
        ? a.workspace.trim()
        : DEFAULT_AGENTS.workspace,
    private_root:
      typeof a.private_root === "string" && a.private_root.trim()
        ? a.private_root.trim()
        : DEFAULT_AGENTS.private_root,
    max_concurrent_agent_runs:
      Number.isFinite(maxRuns) && maxRuns > 0
        ? Math.floor(maxRuns)
        : DEFAULT_AGENTS.max_concurrent_agent_runs,
    manager_schedule_id:
      typeof a.manager_schedule_id === "string" && a.manager_schedule_id.trim()
        ? a.manager_schedule_id.trim()
        : DEFAULT_AGENTS.manager_schedule_id,
  };
}

/**
 * @param {unknown} runnerBlock
 */
export function normalizeHdcRunnerBlock(runnerBlock) {
  const r = isObject(runnerBlock) ? runnerBlock : {};
  return {
    install_root:
      typeof r.install_root === "string" && r.install_root.trim()
        ? r.install_root.trim()
        : DEFAULT_INSTALL_ROOT,
    private_root:
      typeof r.private_root === "string" && r.private_root.trim()
        ? r.private_root.trim()
        : DEFAULT_PRIVATE_ROOT,
    meta_root:
      typeof r.meta_root === "string" && r.meta_root.trim() ? r.meta_root.trim() : DEFAULT_META_ROOT,
    node_version:
      typeof r.node_version === "string" && r.node_version.trim() ? r.node_version.trim() : "22",
    bw_version:
      typeof r.bw_version === "string" && r.bw_version.trim() ? r.bw_version.trim() : "2026.5.0",
    cron_tz:
      typeof r.cron_tz === "string" && r.cron_tz.trim() ? r.cron_tz.trim() : "UTC",
    env: isObject(r.env) ? { ...r.env } : {},
    mail: isObject(r.mail) ? { ...r.mail } : {},
    discord: isObject(r.discord) ? { ...r.discord } : {},
    schedules: Array.isArray(r.schedules) ? r.schedules.filter(isObject) : [],
    sync: isObject(r.sync)
      ? { ...r.sync }
      : {
          exclude: [
            ".git",
            "node_modules",
            "**/reports",
            ".cursor",
            ".vscode",
            ...GUEST_STATE_SYNC_EXCLUDES,
          ],
        },
    web: normalizeHdcRunnerWebBlock(r.web),
    paperclip_bridge: normalizePaperclipBridgeBlock(r.paperclip_bridge),
    agents: normalizeHdcRunnerAgentsBlock(r.agents),
  };
}

/**
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} deployment
 */
export function hdcRunnerSettingsForDeployment(defaults, deployment) {
  const base = normalizeHdcRunnerBlock(isObject(defaults.hdc_runner) ? defaults.hdc_runner : {});
  const over = normalizeHdcRunnerBlock(
    isObject(deployment.hdc_runner) ? deployment.hdc_runner : {},
  );
  return {
    ...base,
    ...over,
    env: { ...base.env, ...over.env },
    mail: { ...base.mail, ...over.mail },
    discord: { ...base.discord, ...over.discord },
    sync: { ...base.sync, ...over.sync },
    schedules: over.schedules.length > 0 ? over.schedules : base.schedules,
    web: {
      ...base.web,
      ...over.web,
      allowed_verbs:
        over.web.allowed_verbs.length > 0 ? over.web.allowed_verbs : base.web.allowed_verbs,
      allowed_schedule_ids:
        over.web.allowed_schedule_ids.length > 0
          ? over.web.allowed_schedule_ids
          : base.web.allowed_schedule_ids,
      allowed_packages:
        over.web.allowed_packages.length > 0 ? over.web.allowed_packages : base.web.allowed_packages,
    },
    paperclip_bridge: {
      ...base.paperclip_bridge,
      ...over.paperclip_bridge,
      enabled: over.paperclip_bridge.enabled || base.paperclip_bridge.enabled,
    },
    agents: {
      ...base.agents,
      ...over.agents,
      enabled: over.agents.enabled !== false && base.agents.enabled !== false,
    },
  };
}

/**
 * @param {ReturnType<typeof normalizeHdcRunnerBlock>} runner
 * @param {Record<string, unknown>} schedule
 */
export function resolveScheduleMail(runner, schedule) {
  const globalMail = isObject(runner.mail) ? runner.mail : {};
  const schedMail = isObject(schedule.mail) ? schedule.mail : {};
  const enabled =
    schedMail.enabled !== undefined
      ? schedMail.enabled === true || schedMail.enabled === 1
      : globalMail.enabled === true || globalMail.enabled === 1;
  const to =
    typeof schedMail.to === "string" && schedMail.to.trim()
      ? schedMail.to.trim()
      : typeof globalMail.to === "string"
        ? globalMail.to.trim()
        : "";
  const from =
    typeof schedMail.from === "string" && schedMail.from.trim()
      ? schedMail.from.trim()
      : typeof globalMail.from === "string"
        ? globalMail.from.trim()
        : "";
  const subject_prefix =
    typeof schedMail.subject_prefix === "string" && schedMail.subject_prefix.trim()
      ? schedMail.subject_prefix.trim()
      : typeof globalMail.subject_prefix === "string"
        ? globalMail.subject_prefix.trim()
        : "[HDC]";
  const on_failure_only =
    schedMail.on_failure_only !== undefined
      ? schedMail.on_failure_only === true
      : globalMail.on_failure_only === true;
  return { enabled, to, from, subject_prefix, on_failure_only };
}

const DEFAULT_DISCORD_WEBHOOK_VAULT_KEY = "HDC_OPS_DISCORD_WEBHOOK_URL";

/**
 * @param {ReturnType<typeof normalizeHdcRunnerBlock>} runner
 * @param {Record<string, unknown>} schedule
 */
export function resolveScheduleDiscord(runner, schedule) {
  const globalDiscord = isObject(runner.discord) ? runner.discord : {};
  const schedDiscord = isObject(schedule.discord) ? schedule.discord : {};
  const enabled =
    schedDiscord.enabled !== undefined
      ? schedDiscord.enabled === true || schedDiscord.enabled === 1
      : globalDiscord.enabled === true || globalDiscord.enabled === 1;
  const title_prefix =
    typeof schedDiscord.title_prefix === "string" && schedDiscord.title_prefix.trim()
      ? schedDiscord.title_prefix.trim()
      : typeof globalDiscord.title_prefix === "string"
        ? globalDiscord.title_prefix.trim()
        : "[HDC]";
  const on_failure_only =
    schedDiscord.on_failure_only !== undefined
      ? schedDiscord.on_failure_only === true
      : globalDiscord.on_failure_only === true;
  const webhook_vault_key =
    typeof schedDiscord.webhook_vault_key === "string" && schedDiscord.webhook_vault_key.trim()
      ? schedDiscord.webhook_vault_key.trim()
      : typeof globalDiscord.webhook_vault_key === "string" && globalDiscord.webhook_vault_key.trim()
        ? globalDiscord.webhook_vault_key.trim()
        : DEFAULT_DISCORD_WEBHOOK_VAULT_KEY;
  return { enabled, title_prefix, on_failure_only, webhook_vault_key };
}

/**
 * @param {ReturnType<typeof normalizeHdcRunnerBlock>} runner
 */
export function syncExcludePatterns(runner) {
  const sync = isObject(runner.sync) ? runner.sync : {};
  const ex = Array.isArray(sync.exclude) ? sync.exclude : [];
  const patterns = ex.map((x) => String(x).trim()).filter(Boolean);
  if (!patterns.includes("/.env")) patterns.push("/.env");
  for (const p of GUEST_STATE_SYNC_EXCLUDES) {
    if (!patterns.includes(p)) patterns.push(p);
  }
  return patterns;
}
