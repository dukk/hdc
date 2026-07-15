import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripFrontmatter } from "./role-prompt.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Record<string, string[]>} */
export const ROLE_SKILL_IDS = {
  "hdc-manager": ["hdc-agent-team", "hdc-manager"],
  "hdc-monitor": ["hdc-agent-team", "hdc-monitor"],
  "hdc-sre-ops": ["hdc-agent-team", "hdc-ops"],
  "hdc-sre-engineer": ["hdc-agent-team", "hdc-sre-engineer"],
  "hdc-engineer": ["hdc-agent-team"],
  "hdc-security-expert": ["hdc-agent-team", "hdc-security"],
  "hdc-security-architect": ["hdc-agent-team", "hdc-security"],
  "hdc-network-architect": ["hdc-agent-team"],
  "hdc-research": ["hdc-agent-team", "hdc-research"],
  "hdc-ops": ["hdc-agent-team", "hdc-ops"],
};

/**
 * @param {string} hdcRoot
 */
export function skillsRoot(hdcRoot) {
  const local = join(PACKAGE_ROOT, "skills");
  if (existsSync(local)) return local;
  const fromRoot = join(hdcRoot, "apps", "hdc-agent-server", "skills");
  if (existsSync(fromRoot)) return fromRoot;
  return join(hdcRoot, ".cursor", "skills");
}

/**
 * @param {string} hdcRoot
 * @param {string} skillId
 */
export function loadSkillMarkdown(hdcRoot, skillId) {
  const path = join(skillsRoot(hdcRoot), skillId, "SKILL.md");
  if (!existsSync(path)) return "";
  return stripFrontmatter(readFileSync(path, "utf8"));
}

/**
 * @param {string} hdcRoot
 * @param {string} role
 */
export function loadSkillsForRole(hdcRoot, role) {
  const normalized = role === "hdc-sre" ? "hdc-sre-ops" : role;
  const ids = ROLE_SKILL_IDS[normalized] ?? ["hdc-agent-team"];
  /** @type {string[]} */
  const parts = [];
  for (const id of ids) {
    const body = loadSkillMarkdown(hdcRoot, id);
    if (body) {
      parts.push(`## Skill: ${id}`, body, "");
    }
  }
  return parts.join("\n").trim();
}

/**
 * @param {string} hdcRoot
 */
export function listFleetSkillIds(hdcRoot) {
  const dir = skillsRoot(hdcRoot);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("hdc-"))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * @param {string} hdcRoot
 */
export function loadAutomationRules(hdcRoot) {
  const candidates = [
    join(PACKAGE_ROOT, "rules", "automation.md"),
    join(hdcRoot, "apps", "hdc-agent-server", "rules", "automation.md"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  return "";
}
