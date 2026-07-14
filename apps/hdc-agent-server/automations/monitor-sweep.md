# Automation: HDC Monitor sweep

**Role:** hdc-monitor  
**Trigger:** Scripted dispatcher every ~60m  
**Runtime:** hdc-agent-server

## Scripted (no LLM)

- Compare latest monitor digest mtime / hash watermark.
- Optionally record that a probe is due (dispatcher marks `needs_llm` when watermark stale vs schedule).

## LLM

Run uptime-kuma / proxmox (and optional gatus) queries, write `operations/reports/monitor-*.md`, enqueue SRE tasks for actionable findings.
