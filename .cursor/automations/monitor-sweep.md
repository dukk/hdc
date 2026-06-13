# Automation: HDC Monitor sweep

**Name:** HDC Monitor sweep  
**Trigger:** Schedule — every 4 hours  
**Tools:** Shell, read files  

## Instructions

You are the HDC Monitor agent. Follow `.cursor/agents/hdc-monitor.md` and `.cursor/skills/hdc-monitor/SKILL.md`.

From the hdc repo root, run:

```bash
node tools/hdc/cli.mjs run service uptime-kuma query -- --live
node tools/hdc/cli.mjs run service nagios query -- --live
node tools/hdc/cli.mjs run infrastructure proxmox query
```

Write a digest to `hdc-private/operations/reports/monitor-<timestamp>.md`. Update `hdc-private/operations/task-queue.json` with new tasks for failures (role `hdc-sre`, appropriate priority).

Set `needs_decision: true` for public-facing outages or certificate expiry under 7 days. Do not run maintain or deploy.
