/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const DEFAULT_INSTALL_ROOT = "/opt/hdc";
const DEFAULT_PRIVATE_ROOT = "/opt/hdc-private";
const DEFAULT_META_ROOT = "/opt/hdc-runner";

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
    env: isObject(r.env) ? { ...r.env } : {},
    mail: isObject(r.mail) ? { ...r.mail } : {},
    discord: isObject(r.discord) ? { ...r.discord } : {},
    schedules: Array.isArray(r.schedules) ? r.schedules.filter(isObject) : [],
    sync: isObject(r.sync)
      ? { ...r.sync }
      : {
          exclude: [".git", "node_modules", "**/reports", ".cursor", ".vscode"],
        },
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
  return patterns;
}
