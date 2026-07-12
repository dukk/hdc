import {
  loadMailRelayAppSettings,
  mailEnabledFromConfig,
  resolveMailRecipients,
} from "./mail-relay-settings.mjs";

/**
 * @param {unknown} block
 * @returns {Record<string, unknown> | null}
 */
export function mailBlockFromService(serviceBlock) {
  if (serviceBlock === null || typeof serviceBlock !== "object" || Array.isArray(serviceBlock)) {
    return null;
  }
  const s = /** @type {Record<string, unknown>} */ (serviceBlock);
  return isObject(s.mail) ? /** @type {Record<string, unknown>} */ (s.mail) : null;
}

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * SMTP env lines for n8n docker .env when mail.enabled.
 * @param {Record<string, unknown>} n8n
 */
export function n8nMailEnvLines(n8n) {
  const mail = mailBlockFromService(n8n);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return [];

  return [
    "N8N_EMAIL_MODE=smtp",
    `N8N_SMTP_HOST=${relay.host}`,
    `N8N_SMTP_PORT=${relay.port}`,
    `N8N_SMTP_SENDER=${recipients.from}`,
    "N8N_SMTP_SSL=false",
    "N8N_SMTP_USER=",
    "N8N_SMTP_PASS=",
  ];
}

/**
 * SMTP env lines for Listmonk docker .env when mail.enabled.
 * @param {Record<string, unknown>} listmonk
 */
export function listmonkMailEnvLines(listmonk) {
  const mail = mailBlockFromService(listmonk);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return [];

  return [
    "LISTMONK_smtp__main__enabled=true",
    `LISTMONK_smtp__main__host=${relay.host}`,
    `LISTMONK_smtp__main__port=${relay.port}`,
    "LISTMONK_smtp__main__auth_protocol=plain",
    "LISTMONK_smtp__main__username=",
    "LISTMONK_smtp__main__password=",
    `LISTMONK_app__from_email=${recipients.from}`,
  ];
}

/**
 * SMTP env lines for DocuSeal docker .env when mail.enabled.
 * @param {Record<string, unknown>} docuseal
 */
export function docusealMailEnvLines(docuseal) {
  const mail = mailBlockFromService(docuseal);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return [];

  return [
    `SMTP_ADDRESS=${relay.host}`,
    `SMTP_PORT=${relay.port}`,
    `SMTP_FROM=${recipients.from}`,
    "SMTP_USERNAME=",
    "SMTP_PASSWORD=",
    "SMTP_ENABLE_STARTTLS=false",
  ];
}

/**
 * SMTP env lines for Twenty docker .env when mail.enabled.
 * @param {Record<string, unknown>} twenty
 */
export function twentyMailEnvLines(twenty) {
  const mail = mailBlockFromService(twenty);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return [];

  const fromName =
    typeof mail?.from_name === "string" && mail.from_name.trim()
      ? mail.from_name.trim()
      : "Twenty CRM";

  return [
    "EMAIL_DRIVER=smtp",
    `EMAIL_SMTP_HOST=${relay.host}`,
    `EMAIL_SMTP_PORT=${relay.port}`,
    `EMAIL_FROM_ADDRESS=${recipients.from}`,
    `EMAIL_FROM_NAME="${fromName.replace(/[\n\r"\\]/g, "")}"`,
    "EMAIL_SMTP_USER=",
    "EMAIL_SMTP_PASSWORD=",
  ];
}

/**
 * SMTP env lines for Vikunja docker .env when mail.enabled.
 * @param {Record<string, unknown>} vikunja
 */
export function vikunjaMailEnvLines(vikunja) {
  const mail = mailBlockFromService(vikunja);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return [];

  return [
    "VIKUNJA_MAILER_ENABLED=true",
    `VIKUNJA_MAILER_HOST=${relay.host}`,
    `VIKUNJA_MAILER_PORT=${relay.port}`,
    "VIKUNJA_MAILER_AUTHTYPE=plain",
    "VIKUNJA_MAILER_USERNAME=",
    "VIKUNJA_MAILER_PASSWORD=",
    `VIKUNJA_MAILER_FROMEMAIL=${recipients.from}`,
    "VIKUNJA_MAILER_FORCESSL=false",
    "VIKUNJA_MAILER_SKIPTLSVERIFY=false",
  ];
}

/**
 * SMTP env lines for AFFiNE docker .env when mail.enabled.
 * Uses mailEnabledFromConfig only (no `to` required — outbound invites/notifications).
 * Omits MAILER_USER/PASSWORD so AFFiNE does not attempt AUTH on the internal relay.
 * @param {Record<string, unknown>} affine
 */
export function affineMailEnvLines(affine) {
  const mail = mailBlockFromService(affine);
  if (!mailEnabledFromConfig(mail)) return [];
  const relay = loadMailRelayAppSettings();
  const from =
    mail && typeof mail.from === "string" && mail.from.trim()
      ? mail.from.trim()
      : relay.from;

  return [
    `MAILER_HOST=${relay.host}`,
    `MAILER_PORT=${relay.port}`,
    `MAILER_SENDER=${from}`,
    "MAILER_IGNORE_TLS=true",
  ];
}

/**
 * SMTP env lines for Vaultwarden docker .env when mail.enabled.
 * @param {Record<string, unknown>} vaultwarden
 */
export function vaultwardenMailEnvLines(vaultwarden) {
  const mail = mailBlockFromService(vaultwarden);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return [];

  // Internal relay trusts LAN (mynetworks); omit SMTP_USERNAME/PASSWORD so Vaultwarden
  // does not attempt AUTH (empty strings still trigger auth and fail on port 25).
  return [
    `SMTP_HOST=${relay.host}`,
    `SMTP_PORT=${relay.port}`,
    `SMTP_FROM=${recipients.from}`,
    "SMTP_SECURITY=off",
  ];
}

/**
 * Extra env keys for Postiz when mail.enabled (merged before env_extra).
 * @param {Record<string, unknown>} postiz
 */
export function postizMailEnvEntries(postiz) {
  const mail = mailBlockFromService(postiz);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return {};

  return {
    SMTP_HOST: relay.host,
    SMTP_PORT: String(relay.port),
    SMTP_FROM: recipients.from,
    SMTP_USER: "",
    SMTP_PASSWORD: "",
  };
}

/**
 * Gatus alerting.email YAML block when gatus.mail.enabled.
 * @param {Record<string, unknown>} gatus
 */
export function gatusMailAlertingYaml(gatus) {
  const mail = mailBlockFromService(gatus);
  const relay = loadMailRelayAppSettings();
  const recipients = resolveMailRecipients(mail, { from: relay.from });
  if (!recipients) return "";

  const q = (s) => {
    const t = String(s);
    if (/^[\w./:@%+-]+$/.test(t) && !t.includes(":")) return t;
    return `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  };

  return [
    "alerting:",
    "  email:",
    `    from: ${q(recipients.from)}`,
    '    username: ""',
    '    password: ""',
    `    host: ${q(relay.host)}`,
    `    port: ${relay.port}`,
    `    to: ${q(recipients.to)}`,
  ].join("\n");
}

/**
 * Bash snippet to apply Laravel MAIL_* vars in /opt/solidtime/.env
 * @param {Record<string, unknown>} solidtime
 */
export function solidtimeMailEnvBashSnippet(solidtime) {
  const mail = mailBlockFromService(solidtime);
  const relay = loadMailRelayAppSettings();
  const mailer =
    typeof solidtime.mail_mailer === "string" && solidtime.mail_mailer.trim()
      ? solidtime.mail_mailer.trim()
      : mailEnabledFromConfig(mail)
        ? "smtp"
        : "log";

  if (mailer !== "smtp") {
    return [
      'sed -i "s|^MAIL_MAILER=.*|MAIL_MAILER=log|" /opt/solidtime/.env',
    ].join("\n");
  }

  const from =
    mail && typeof mail.from === "string" && mail.from.trim()
      ? mail.from.trim()
      : relay.from;

  const esc = (s) => String(s).replace(/'/g, `'\\''`);
  return [
    'test -f /opt/solidtime/.env',
    `sed -i "s|^MAIL_MAILER=.*|MAIL_MAILER=smtp|" /opt/solidtime/.env`,
    `grep -q "^MAIL_HOST=" /opt/solidtime/.env || echo "MAIL_HOST=${esc(relay.host)}" >> /opt/solidtime/.env`,
    `sed -i "s|^MAIL_HOST=.*|MAIL_HOST=${esc(relay.host)}|" /opt/solidtime/.env`,
    `grep -q "^MAIL_PORT=" /opt/solidtime/.env || echo "MAIL_PORT=${relay.port}" >> /opt/solidtime/.env`,
    `sed -i "s|^MAIL_PORT=.*|MAIL_PORT=${relay.port}|" /opt/solidtime/.env`,
    `grep -q "^MAIL_USERNAME=" /opt/solidtime/.env || echo "MAIL_USERNAME=" >> /opt/solidtime/.env`,
    `sed -i "s|^MAIL_USERNAME=.*|MAIL_USERNAME=|" /opt/solidtime/.env`,
    `grep -q "^MAIL_PASSWORD=" /opt/solidtime/.env || echo "MAIL_PASSWORD=" >> /opt/solidtime/.env`,
    `sed -i "s|^MAIL_PASSWORD=.*|MAIL_PASSWORD=|" /opt/solidtime/.env`,
    `grep -q "^MAIL_ENCRYPTION=" /opt/solidtime/.env || echo "MAIL_ENCRYPTION=null" >> /opt/solidtime/.env`,
    `sed -i "s|^MAIL_ENCRYPTION=.*|MAIL_ENCRYPTION=null|" /opt/solidtime/.env`,
    `grep -q "^MAIL_FROM_ADDRESS=" /opt/solidtime/.env || echo "MAIL_FROM_ADDRESS='${esc(from)}'" >> /opt/solidtime/.env`,
    `sed -i "s|^MAIL_FROM_ADDRESS=.*|MAIL_FROM_ADDRESS='${esc(from)}'|" /opt/solidtime/.env`,
  ].join("\n");
}
