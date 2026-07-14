# Automation: HDC Security sweep

**Role:** hdc-security-expert  
**Trigger:** Scripted dispatcher every ~120m  
**Runtime:** hdc-agent-server

## Scripted (no LLM)

- Watermark on latest `operations/reports/security-*.md`.

## LLM

Query wazuh / crowdsec / nginx-waf; write security digest; bounded response (`--sync-bouncers`) only within policy; escalate novel threats.
