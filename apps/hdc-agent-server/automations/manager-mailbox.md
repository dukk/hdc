# Automation: HDC Manager mailbox

**Role:** hdc-manager  
**Trigger:** Scripted dispatcher every ~15m (before triage)  
**Runtime:** hdc-agent-server IMAP poll → `lib/manager-mailbox.mjs`

## Scripted (no LLM)

1. IMAP FETCH UNSEEN on `manager@hdc.dukk.org` (config: `hdc_agents.mailbox` / `/opt/hdc-agents-meta/mailbox.json`).
2. Silent Discord for each received message (from/subject/uid only).
3. Classify:
   - **Wazuh level ≥ 10** with external source IP → create/approve `hdc-security-expert` task with `unifi-network maintain --block` suggested command (auto-runnable).
   - **Trusted sender decision** (`approve`/`reject` + task id) requiring Authentication-Results SPF/DKIM/DMARC pass; spoof → noisy Discord, no task change.
   - **Other mail** → create/update manager task (keyed by Message-ID).
4. Persist watermark in `operations/.mailbox-state.json`.

Agent aliases (`monitor@`, `sre@`, …) forward to the manager mailbox in Mailcow. Outbound schedule mail uses per-role `mail.from` / `role_from` (not `noreply@`).
