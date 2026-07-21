# Automation: HDC Monitor sweep

**Role:** hdc-monitor  
**Trigger:** Scripted dispatcher every ~60m  
**Runtime:** hdc-agent-server

## Scripted (no LLM)

1. Run outage pre-check (`monitor-outage-check`):
   - `uptime-kuma query --failing-only` (heartbeat DOWN)
   - `homepage query --failing-only` (siteMonitor / ping red-dot equivalents)
   - `proxmox query --failing-only` (stopped guests / unhealthy nodes)
2. Build stable outage fingerprint in `operations/.dispatcher-state.json` (`monitor_outage_fingerprint`).
3. If no outages → idle (clear fingerprint).
4. If same fingerprint as prior cycle → idle (skip LLM).
5. If new/changed outages → invoke monitor LLM with markdown summary.

## LLM

Write `operations/reports/monitor-*.md`, create/update `operations/tasks/` with stable ids (`monitor-outage-<slug>`). Investigation tasks → `hdc-sre-ops`; package fixes → `hdc-sre-engineer`. Remediation requiring deploy/maintain → `needs_decision: true`.

After the monitor turn completes, the monitor container triggers manager `/internal/scan-decisions` so approval notifications are sent without waiting for the 15m manager tick.

## Approvals and execution

Operator Approve (Discord/Slack/web) calls manager `/internal/dispatch-task` to A2A the task role agent immediately (no 15m wait).
