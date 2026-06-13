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
node tools/hdc/cli.mjs run service wazuh query -- --live
node tools/hdc/cli.mjs run service crowdsec query -- --live
node tools/hdc/cli.mjs run service nginx-waf query
node tools/hdc/cli.mjs run service splunk query
```

## Active response (expert only)

```bash
node tools/hdc/cli.mjs run service crowdsec maintain -- --sync-bouncers
```

WAF blocks are config-driven in `packages/services/nginx-waf/config.json` — changes need approval and SRE execution.

**Do not:** ad-hoc iptables, SSH firewall edits, or deploy without approved task.

## Config locations (hdc-private)

- `packages/services/crowdsec/config.json`
- `packages/services/wazuh/config.json`
- `packages/services/nginx-waf/config.json`
- `packages/infrastructure/proxmox/config.json` → `provision.guest_agents`

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
