import { flagGet } from "./parse-argv-flags.mjs";

export const WAZUH_MANAGER_CONF_REL = "config/wazuh_cluster/wazuh_manager.conf";

/**
 * @param {Record<string, string>} [flags]
 */
export function wazuhManagerAlertsSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-wazuh-mail", "skip_wazuh_mail") !== undefined;
}

/**
 * @param {string} text
 * @param {string} tag
 * @param {string} value
 */
export function patchOssecXmlTag(text, tag, value) {
  const pattern = new RegExp(`<${tag}>[^<]*</${tag}>`);
  const replacement = `<${tag}>${value}</${tag}>`;
  if (pattern.test(text)) return text.replace(pattern, replacement);
  return text;
}

/**
 * @param {string} confText
 * @param {{ smtp_server: string; email_from: string; email_to: string; alert_level: number; max_per_hour: number }} mail
 */
export function patchWazuhManagerConfEmail(confText, mail) {
  let text = confText;
  text = patchOssecXmlTag(text, "email_notification", "yes");
  text = patchOssecXmlTag(text, "smtp_server", mail.smtp_server);
  text = patchOssecXmlTag(text, "email_from", mail.email_from);
  text = patchOssecXmlTag(text, "email_to", mail.email_to);
  text = patchOssecXmlTag(text, "email_maxperhour", String(mail.max_per_hour));
  text = patchOssecXmlTag(text, "email_alert_level", String(mail.alert_level));
  return text;
}

/**
 * Bash fragment: patch wazuh_manager.conf email settings (expects STACK).
 *
 * @param {{ smtp_server: string; email_from: string; email_to: string[]; alert_level: number; max_per_hour: number }} mailSettings
 */
/**
 * Wazuh manager global email_to accepts comma-separated recipients.
 *
 * @param {string[]} recipients
 */
export function formatWazuhManagerEmailTo(recipients) {
  return recipients.map((r) => r.trim()).filter(Boolean).join(",");
}

export function buildWazuhManagerAlertsPatchBash(mailSettings) {
  const emailTo = formatWazuhManagerEmailTo(mailSettings.email_to);
  const mail = {
    smtp_server: mailSettings.smtp_server,
    email_from: mailSettings.email_from,
    email_to: emailTo,
    alert_level: mailSettings.alert_level,
    max_per_hour: mailSettings.max_per_hour,
  };
  const confRel = WAZUH_MANAGER_CONF_REL;
  const mailJson = JSON.stringify(mail);
  return [
    `test -f '${confRel.replace(/'/g, `'\\''`)}'`,
    `python3 - <<'PY'`,
    "from pathlib import Path",
    "import os",
    "import re",
    "import json",
    "",
    `conf_rel = ${JSON.stringify(confRel)}`,
    `mail = json.loads(${JSON.stringify(mailJson)})`,
    "stack = Path(os.environ['STACK'])",
    "conf_path = stack / conf_rel",
    "if not conf_path.is_file():",
    "  raise SystemExit(f'missing {conf_path}')",
    "",
    "def set_tag(text, tag, value):",
    "  pattern = re.compile(rf'<{tag}>[^<]*</{tag}>')",
    "  repl = f'<{tag}>{value}</{tag}>'",
    "  if pattern.search(text):",
    "    return pattern.sub(repl, text, count=1)",
    "  return text",
    "",
    "text = conf_path.read_text()",
    "text = set_tag(text, 'email_notification', 'yes')",
    "text = set_tag(text, 'smtp_server', mail['smtp_server'])",
    "text = set_tag(text, 'email_from', mail['email_from'])",
    "text = set_tag(text, 'email_to', mail['email_to'])",
    "text = set_tag(text, 'email_maxperhour', str(mail['max_per_hour']))",
    "text = set_tag(text, 'email_alert_level', str(mail['alert_level']))",
    "conf_path.write_text(text)",
    "print('wazuh manager email settings patched')",
    "PY",
    "docker compose restart wazuh.manager",
  ].join("\n");
}
