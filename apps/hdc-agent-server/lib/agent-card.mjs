import { existsSync, readFileSync } from "node:fs";

import { rolePromptPath, stripFrontmatter } from "./role-prompt.mjs";
import { listFleetSkillIds } from "./skill-load.mjs";

const A2A_VERSION = "0.3.0";

/**
 * @param {{ role: string, hostHeader: string, hdcRoot: string }} opts
 */
export function buildAgentCard(opts) {
  const { role, hostHeader, hdcRoot } = opts;
  const host = hostHeader.split(":")[0] || "localhost";
  const port = hostHeader.includes(":") ? hostHeader.split(":")[1] : "9200";
  const baseUrl = `http://${host}:${port}`;
  const agentPath = rolePromptPath(hdcRoot, role);
  let description = `HDC agent ${role}`;
  if (existsSync(agentPath)) {
    const md = readFileSync(agentPath, "utf8");
    const descMatch = md.match(/^description:\s*>-\s*\n((?:\s{2}.+\n)+)/m);
    if (descMatch) {
      description = descMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
    } else {
      const body = stripFrontmatter(md).split("\n").find((l) => l.trim() && !l.startsWith("#"));
      if (body) description = body.trim().slice(0, 240);
    }
  }

  const skills = listFleetSkillIds(hdcRoot).map((id) => ({
    id,
    name: id,
    description: `Skill ${id}`,
  }));

  return {
    name: role,
    description,
    version: A2A_VERSION,
    protocolVersion: "0.3",
    url: `${baseUrl}/a2a`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      { id: `${role}.execute`, name: `${role} execute`, description },
      ...skills.slice(0, 12),
    ],
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: "HTTP+JSON",
      },
    ],
  };
}
