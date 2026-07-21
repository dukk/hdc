# Automation: HDC Maintainer scan

**Role:** hdc-maintainer  
**Trigger:** Scripted dispatcher every ~24h (1440m)  
**Runtime:** hdc-agent-server

## Scripted (no LLM)

1. Run maintenance pre-check (`maintenance-scan`):
   - `client windows|client-ubuntu|raspberrypi query` — pending updates, `reboot_required`
   - Weekly client maintain scheduler log verification
   - Service version probes (catalog + GitHub latest)
   - `proxmox query --reboot-required`, `proxmox query --pending-os-updates`
2. Upsert `operations/tasks/maintainer-*` for reboot, upgrade, hypervisor OS, overdue routine
3. Build fingerprint in `operations/.dispatcher-state.json` (`maintainer_scan_fingerprint`)
4. If no requirements → idle (clear fingerprint)
5. If same fingerprint as prior cycle → idle (skip LLM)
6. If new/changed requirements → invoke maintainer LLM with markdown summary

## LLM

Write `operations/reports/maintainer-*.md`, refine task bodies. Reboot and service upgrade tasks → `hdc-sre-ops` with `needs_decision: true`.

After the maintainer turn completes, the maintainer container triggers manager `/internal/scan-decisions` so approval notifications are sent without waiting for the 15m manager tick.

## Approvals and execution

Operator Approve (Discord/Slack/web) calls manager `/internal/dispatch-task` to A2A **hdc-sre-ops** for approved maintain/reboot/upgrade work.
