/** Env var names whose values are not secrets (override substring heuristics). */
const PUBLIC_HDC_KEYS = new Set([
  "HDC_CLI_INVOCATION",
  "HDC_SKIP_LOCAL_SYSTEM_INVENTORY",
]);

/** Mask values when the name suggests a credential or token. */
const SENSITIVE_NAME_RE = /PASSWORD|PASSPHRASE|SECRET|TOKEN|API_KEY|_KEY$/i;

/**
 * @param {string} key
 */
export function hdcEnvKeyLooksSensitive(key) {
  if (PUBLIC_HDC_KEYS.has(key)) return false;
  return SENSITIVE_NAME_RE.test(key);
}

/**
 * Single-line display for one HDC_* variable (secrets redacted).
 * @param {string} key
 * @param {string | undefined} value
 */
export function formatHdcEnvValueForDisplay(key, value) {
  if (value === undefined) return "(undefined)";
  if (value === "") return "(empty)";
  if (hdcEnvKeyLooksSensitive(key)) return `(set, ${value.length} chars)`;
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ key: string; value: string; display: string }[]}
 */
export function collectHdcEnvRows(env) {
  const keys = Object.keys(env)
    .filter((k) => k.startsWith("HDC_"))
    .sort((a, b) => a.localeCompare(b));
  return keys.map((key) => {
    const value = env[key];
    const v = value === undefined ? undefined : String(value);
    return {
      key,
      value: v ?? "",
      display: formatHdcEnvValueForDisplay(key, v),
    };
  });
}
