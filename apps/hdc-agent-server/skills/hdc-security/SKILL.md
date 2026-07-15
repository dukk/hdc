---
name: hdc-security
description: >-
  HDC security queries and response: Wazuh, CrowdSec, nginx-waf, Splunk; bouncer sync;
  proposal format for security architect. Use with security expert or architect agents.
disable-model-invocation: true
---

# HDC security skill

## Query runbook

```bash
hdc run service wazuh query -- --live
hdc run service crowdsec query -- --live
hdc run service nginx-waf query
hdc run service splunk query
```

## Active response (expert only)

```bash
hdc run service crowdsec maintain -- --sync-bouncers
```

WAF blocks are config-driven in `clumps/services/nginx-waf/config.json` — changes need approval and SRE execution.

**Do not:** ad-hoc iptables, SSH firewall edits, or deploy without approved task.

## Config locations (hdc-private)

- `clumps/services/crowdsec/config.json`
- `clumps/services/wazuh/config.json`
- `clumps/services/nginx-waf/config.json`
- `clumps/infrastructure/proxmox/config.json` → `provision.guest_agents`

## Security architect proposal template

Path: `operations/proposals/security/<date>-<slug>.md`

```markdown
# <title>

**Severity:** critical | high | medium | low
**Date:** YYYY-MM-DD

## Risk
…

## Affected systems
- inventory-id — role

## Recommendation
…

## HDC commands
```bash
…
```

## Rollback
…

## Effort
S | M | L
```

## Escalation

Critical/active incident → task with `needs_decision: true`, Discord notify, Manager aware immediately.
