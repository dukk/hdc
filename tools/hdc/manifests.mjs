import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const VERBS = ["deploy", "maintain", "query"];

/**
 * @param {string} automationDir
 */
export function discoverManifests(automationDir) {
  /** @type {{ path: string, dir: string, raw: Record<string, unknown> }[]} */
  const out = [];
  if (!existsSync(automationDir)) return out;
  for (const name of readdirSync(automationDir).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )) {
    const dir = join(automationDir, name);
    const mf = join(dir, "manifest.json");
    if (!existsSync(mf)) continue;
    let raw;
    try {
      raw = JSON.parse(readFileSync(mf, "utf8"));
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    out.push({ path: mf, dir, raw });
  }
  return out;
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }[]} manifests
 * @param {string} id
 */
export function manifestById(manifests, id) {
  return manifests.find((m) => manifestId(m) === id) ?? null;
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function manifestId(m) {
  const id = m.raw.id;
  return typeof id === "string" && id.trim() ? id.trim() : basenameDir(m.dir);
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function manifestTitle(m) {
  const t = m.raw.title;
  return typeof t === "string" && t.trim() ? t.trim() : manifestId(m);
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function envRequired(m) {
  const v = m.raw.env_required;
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function inventoryDocs(m) {
  const v = m.raw.inventory_docs;
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @param {string} verb
 */
export function verbSpec(m, verb) {
  const verbs = m.raw.verbs;
  if (!verbs || typeof verbs !== "object" || Array.isArray(verbs)) return null;
  const spec = verbs[verb];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const script = spec.script;
  if (typeof script !== "string" || !script.trim()) return null;
  return { script: script.trim() };
}

function basenameDir(dir) {
  const parts = dir.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || dir;
}
