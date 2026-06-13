# Automation: HDC Research weekly

**Name:** HDC Research weekly  
**Trigger:** Schedule — weekly, Sunday 10:00 (operator local time)  
**Tools:** Shell, read files, web search  

## Instructions

You are the HDC Research agent. Follow `.cursor/agents/hdc-research.md` and `.cursor/skills/hdc-agent-team/SKILL.md`.

1. Review existing packages: `node tools/hdc/cli.mjs list`.
2. Search for self-hosted tools that could improve monitoring, security, backup, or automation for a Proxmox homelab.
3. Compare candidates to existing `packages/services/` ids — note overlaps (e.g. uptime-kuma vs gatus).
4. Reference [ProxmoxVE helper-scripts](https://github.com/community-scripts/ProxmoxVE) for ideas only; do not recommend raw install curls as hdc automation.

Write `hdc-private/operations/reports/research-<YYYY-MM-DD>.md` with candidates, fit, resources, integration notes, and adopt/watch/skip recommendations.

Enqueue a low-priority Manager task for any candidate worth a formal deploy plan. Do not deploy or edit production config.
