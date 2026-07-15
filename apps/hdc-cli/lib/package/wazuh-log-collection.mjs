import { flagGet } from "./parse-argv-flags.mjs";
import { wazuhAgentInstalledCheckCommand, wazuhAgentSkippedByFlags } from "./wazuh-agent-ensure.mjs";

const OSSEC_CONF = "/var/ossec/etc/ossec.conf";
const MARKER_BEGIN = "<!-- hdc-managed-log-collection begin -->";
const MARKER_END = "<!-- hdc-managed-log-collection end -->";

const LOG_FORMATS = new Set([
  "syslog",
  "json",
  "snort-full",
  "apache",
  "iis",
  "squid",
  "eventchannel",
  "multi-line",
  "multi-line-regex",
  "audit",
  "mysql_log",
  "postgresql_log",
  "oscap",
  "nmapg",
  "djbsmtp",
  "ossec",
  "command",
  "full_command",
  "multi-line-json",
]);

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, string>} [flags]
 */
export function wazuhLogCollectionSkippedByFlags(flags) {
  if (wazuhAgentSkippedByFlags(flags)) return true;
  return flagGet(flags ?? {}, "skip-wazuh-log-collection", "skip_wazuh_log_collection") !== undefined;
}

/**
 * @param {unknown} raw
 * @returns {{ location: string; log_format: string }[]}
 */
export function normalizeWazuhLogCollectionEntries(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {{ location: string; log_format: string }[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!isObject(item)) continue;
    const location = typeof item.location === "string" ? item.location.trim() : "";
    const logFormatRaw = typeof item.log_format === "string" ? item.log_format.trim() : "syslog";
    if (!location.startsWith("/")) continue;
    const log_format = LOG_FORMATS.has(logFormatRaw) ? logFormatRaw : "syslog";
    const key = `${log_format}\0${location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ location, log_format });
  }
  return out;
}

/**
 * @param {{ location: string; log_format: string }[]} entries
 */
export function renderWazuhManagedLocalfileBlock(entries) {
  if (!entries.length) return "";
  const lines = [MARKER_BEGIN];
  for (const entry of entries) {
    lines.push("  <localfile>");
    lines.push(`    <log_format>${entry.log_format}</log_format>`);
    lines.push(`    <location>${entry.location}</location>`);
    lines.push("  </localfile>");
  }
  lines.push(MARKER_END);
  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} block
 */
export function buildWazuhLogCollectionApplyScript(block) {
  const blockB64 = Buffer.from(block, "utf8").toString("base64");
  return [
    "set -euo pipefail",
    "if ! " + wazuhAgentInstalledCheckCommand() + "; then",
    '  echo "wazuh-agent not installed"',
    "  exit 2",
    "fi",
    `export BLOCK_B64='${blockB64}'`,
    "python3 - <<'PY'",
    "import base64",
    "import os",
    "import re",
    "import subprocess",
    "from pathlib import Path",
    "",
    `marker_begin = ${JSON.stringify(MARKER_BEGIN)}`,
    `marker_end = ${JSON.stringify(MARKER_END)}`,
    `conf_path = Path(${JSON.stringify(OSSEC_CONF)})`,
    "block = base64.b64decode(os.environ['BLOCK_B64']).decode('utf-8')",
    "",
    "if not conf_path.is_file():",
    "  raise SystemExit(f'missing {conf_path}')",
    "",
    "text = conf_path.read_text()",
    "pattern = re.compile(",
    "  re.escape(marker_begin) + r'.*?' + re.escape(marker_end) + r'\\n?',",
    "  re.DOTALL,",
    ")",
    "new_text, removed = pattern.subn('', text)",
    "changed = removed > 0",
    "",
    "if block.strip():",
    "  close_tag = '</ossec_config>'",
    "  idx = new_text.rfind(close_tag)",
    "  if idx < 0:",
    "    raise SystemExit('ossec.conf missing </ossec_config>')",
    "  insertion = block if block.endswith('\\n') else block + '\\n'",
    "  new_text = new_text[:idx] + insertion + new_text[idx:]",
    "  changed = True",
    "",
    "if changed:",
    "  conf_path.write_text(new_text)",
    "  subprocess.run(['systemctl', 'restart', 'wazuh-agent'], check=False)",
    "  print('applied')",
    "else:",
    "  print('unchanged')",
    "PY",
  ].join("\n");
}

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {{ location: string; log_format: string }[]} opts.entries
 */
export async function ensureWazuhLogCollection(opts) {
  if (wazuhLogCollectionSkippedByFlags(opts.flags)) {
    opts.log.info(`${opts.exec.label}: Wazuh log collection skipped (--skip-wazuh-agent or --skip-wazuh-log-collection)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const entries = normalizeWazuhLogCollectionEntries(opts.entries);
  if (!entries.length) {
    return { ok: true, skipped: true, message: "no log_collection entries configured" };
  }

  const installed =
    opts.exec.run(wazuhAgentInstalledCheckCommand(), { capture: true }).status === 0;
  if (!installed) {
    return { ok: true, skipped: true, message: "wazuh-agent not installed" };
  }

  const block = renderWazuhManagedLocalfileBlock(entries);
  const script = buildWazuhLogCollectionApplyScript(block);

  try {
    opts.log.info(
      `${opts.exec.label}: ensuring Wazuh log collection (${entries.length} path${entries.length === 1 ? "" : "s"})`,
    );
    const r = opts.exec.run(script, { capture: true });
    if (r.status === 2) {
      return { ok: true, skipped: true, message: "wazuh-agent not installed" };
    }
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    const outcome = r.stdout.trim().split("\n").pop() || "applied";
    return {
      ok: true,
      skipped: false,
      message: outcome === "unchanged" ? "log collection unchanged" : "log collection applied",
      entries: entries.map((e) => e.location),
      changed: outcome === "applied",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) opts.log.warn(`${opts.exec.label}: Wazuh log collection failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
