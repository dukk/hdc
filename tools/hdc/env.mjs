import { readFileSync, existsSync } from "node:fs";

const LINE_RE =
  /^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<val>.*?)\s*$/;

/**
 * Load KEY=VALUE pairs from a `.env` file into `process.env` (minimal parser, no deps).
 * @param {string} filePath
 * @param {boolean} [override=false]
 */
export function loadDotenv(filePath, override = false) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
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
    const key = m.groups.key;
    if (override || process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
