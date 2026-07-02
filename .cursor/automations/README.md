# HDC Cursor Automations

Draft specifications for scheduled agents. **Primary execution** is on **hdc-runner** via Cursor CLI (`agent-manager-hourly` and optional `agent-*` schedules). These files are synced to `/opt/hdc/.cursor/automations/` on each `hdc-runner maintain`.

You may also create matching automations in the **Cursor Automations** editor for local IDE sessions.

| File | hdc-runner schedule | Role |
| --- | --- | --- |
| [manager-triage.md](manager-triage.md) | `agent-manager-hourly` (hourly) | hdc-manager |
| [monitor-sweep.md](monitor-sweep.md) | `agent-monitor-sweep` (optional) | hdc-monitor |
| [security-sweep.md](security-sweep.md) | `agent-security-sweep` (optional) | hdc-security-expert |
| [research-weekly.md](research-weekly.md) | `agent-research-weekly` (optional) | hdc-research |

**Task state:** Guest-authoritative on hdc-runner at `/opt/hdc-private/operations/tasks/`. Approve via web UI Tasks tab or A2A.

**Tools:** Enable shell/terminal and file read for all. Research automation may use web search.

**Discord:** Manager should run `node tools/hdc/lib/notify-discord.mjs` when tasks have `needs_decision: true` (requires vault `HDC_OPS_DISCORD_WEBHOOK_URL`).

**Email:** hdc-runner cron jobs email failures via postfix-relay automatically; Manager summarizes but does not duplicate unless asked.
