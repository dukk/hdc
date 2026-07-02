# Automation: HDC Monitor sweep

**Name:** HDC Monitor sweep  
**Trigger:** Schedule — every 4 hours (`agent-monitor-sweep` on hdc-runner, optional)  
**Tools:** Shell, read files  

## Instructions

You are the HDC Monitor agent. Follow `.cursor/agents/hdc-monitor.md` and `.cursor/skills/hdc-monitor/SKILL.md`.

From the hdc repo root, run:

```bash
node tools/hdc/cli.mjs run service uptime-kuma query -- --live
node tools/hdc/cli.mjs run infrastructure proxmox query
```

Write a digest to `hdc-private/operations/reports/monitor-<timestamp>.md`. Create new task files under `hdc-private/operations/tasks/` for failures (role `hdc-sre`, appropriate priority).

Set `needs_decision: true` for public-facing outages or certificate expiry under 7 days. Do not run maintain or deploy.

Regenerate `operations/task-report.md` when adding tasks.
