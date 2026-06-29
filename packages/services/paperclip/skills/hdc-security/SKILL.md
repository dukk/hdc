---
name: hdc-security
description: Use when running Wazuh, CrowdSec, or nginx-waf security queries via hdc-runner, syncing bouncers, or drafting security proposals. Do not use for ad-hoc iptables or deploy without approval.
slug: hdc-security
---

# HDC security skill

Use **hdc-runner** skill for API auth.

## Security schedules

```http
POST /api/schedules/security-crowdsec/run
POST /api/schedules/security-wazuh/run
POST /api/schedules/security-waf/run
```

## Ad-hoc queries

```json
{"tier":"service","package":"wazuh","verb":"query","args":["--live"]}
```

```json
{"tier":"service","package":"crowdsec","verb":"query","args":["--live"]}
```

```json
{"tier":"service","package":"nginx-waf","verb":"query"}
```

## Active response (approved only)

```json
{"tier":"service","package":"crowdsec","verb":"maintain","args":["--sync-bouncers"]}
```

WAF blocks are config-driven in `packages/services/nginx-waf/config.json` — changes need approval and SRE execution.

## Escalation

Critical/active incident → notify HDC Manager immediately; set Paperclip issue priority critical.

## Proposals

Read-only analysis → write to `operations/proposals/security/<date>-<slug>.md` (via synced hdc-private on runner).

Do not commit secret values. Never run deploy without approved issue.
