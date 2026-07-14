import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} hdcRoot
 * @param {string} role
 */
export function loadRolePrompt(hdcRoot, role) {
  const path = join(hdcRoot, ".cursor", "agents", `${role}.md`);
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
