/**
 * Parse `--key` / `--key value` pairs (repeatable `--key` last wins).
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
export function parseArgvFlags(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "1";
    }
  }
  return out;
}

/**
 * @param {Record<string, string>} flags
 * @param {...string} keys
 */
export function flagGet(flags, ...keys) {
  for (const k of keys) {
    const v = flags[k];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/**
 * @param {string | undefined} v
 * @param {number | undefined} fallback
 */
export function flagNumber(v, fallback) {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
