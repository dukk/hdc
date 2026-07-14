import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve path to fleet agent definition.
 * Prefers package-local agents/, then hdcRoot/apps/hdc-agent-server/agents/.
 *
 * @param {string} hdcRoot
 * @param {string} role
 */
export function rolePromptPath(hdcRoot, role) {
  const local = join(PACKAGE_ROOT, "agents", `${role}.md`);
  if (existsSync(local)) return local;
  const fromRoot = join(hdcRoot, "apps", "hdc-agent-server", "agents", `${role}.md`);
  if (existsSync(fromRoot)) return fromRoot;
  // Legacy Cursor path (fallback plane / old images)
  const legacy = join(hdcRoot, ".cursor", "agents", `${role}.md`);
  if (existsSync(legacy)) return legacy;
  return fromRoot;
}

/**
 * @param {string} hdcRoot
 * @param {string} role
 */
export function loadRolePrompt(hdcRoot, role) {
  const path = rolePromptPath(hdcRoot, role);
  if (!existsSync(path)) {
    return `You are the HDC agent role ${role}. Follow hdc-agent-team conventions.`;
  }
  return readFileSync(path, "utf8");
}

/**
 * Strip YAML frontmatter for a shorter system prompt body.
 * @param {string} md
 */
export function stripFrontmatter(md) {
  const text = String(md ?? "");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return text;
  return text.slice(end + 4).trim();
}
