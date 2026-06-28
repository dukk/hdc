import { readFileSync, existsSync } from "node:fs";

const LINE_RE =
  /^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<val>.*?)\s*$/;

/**
 * Parse KEY=VALUE lines from `.env` text.
 * @param {string} text
 * @returns {{ key: string; value: string }[]}
 */
export function parseDotenvText(text) {
  /** @type {{ key: string; value: string }[]} */
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = rawLine.match(LINE_RE);
    if (!m?.groups) continue;
    let val = m.groups.val;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    val = val.replace(/\\n/g, "\n");
    out.push({ key: m.groups.key, value: val });
  }
  return out;
}

/**
 * Apply KEY=VALUE pairs from a `.env` file into `targetEnv` (minimal parser, no deps).
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} targetEnv
 * @param {boolean} [override=false] When false, skip keys already set in targetEnv.
 * @returns {number} Number of keys applied
 */
export function applyDotenvFile(filePath, targetEnv, override = false) {
  if (!existsSync(filePath)) return 0;
  const text = readFileSync(filePath, "utf8");
  let applied = 0;
  for (const { key, value } of parseDotenvText(text)) {
    if (override || targetEnv[key] === undefined) {
      targetEnv[key] = value;
      applied++;
    }
  }
  return applied;
}

/**
 * Load KEY=VALUE pairs from a `.env` file into `process.env` (minimal parser, no deps).
 * @param {string} filePath
 * @param {boolean} [override=false]
 */
export function loadDotenv(filePath, override = false) {
  applyDotenvFile(filePath, process.env, override);
}
