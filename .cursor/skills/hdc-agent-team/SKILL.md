---
name: hdc-agent-team
description: >-
  Shared conventions for the HDC Cursor subagent team: task queue, digests, escalation,
  and hdc-private operations paths. Use when any hdc-manager/monitor/sre/security agent runs.
disable-model-invocation: true
---

# HDC agent team conventions

## Paths (hdc-private)

| Path | Purpose |
| --- | --- |
| `operations/task-queue.json` | Canonical work queue |
| `operations/delegation-policy.md` | Approval rules |
| `operations/ip-allocations.md` | IP group boundaries and next-free addresses (Servers network — see file) |
| `operations/reports/` | Monitor, security, research digests |
| `operations/proposals/security/` | Security architect output |
| `operations/proposals/network/` | Network architect output |

Resolve hdc-private via sibling `../hdc-private` or `HDC_PRIVATE_ROOT` in `.env`.

## Task queue schema (v1)

```json
{
  "schema_version": 1,
  "tasks": [
    {
      "id": "2026-06-13-monitor-immich",
      "role": "hdc-sre",
      "priority": "high",
      "status": "pending",
      "title": "Immich monitor down",
      "evidence": ["operations/reports/monitor-2026-06-13T08-00.md"],
      "suggested_commands": ["node tools/hdc/cli.mjs run service immich query -- --live"],
      "needs_decision": false,
      "created_at": "2026-06-13T08:05:00Z"
    }
  ]
}
```

**Status:** `pending` | `approved` | `in_progress` | `blocked` | `done`

**Priority:** `critical` | `high` | `medium` | `low`

**Role:** `hdc-manager` | `hdc-sre` | `hdc-monitor` | `hdc-security-expert` | `hdc-security-architect` | `hdc-network-architect` | `hdc-research`

## Agent roster

| Agent | File |
| --- | --- |
| Manager | `.cursor/agents/hdc-manager.md` |
| Monitor | `.cursor/agents/hdc-monitor.md` |
| SRE | `.cursor/agents/hdc-sre.md` |
| Security expert | `.cursor/agents/hdc-security-expert.md` |
| Security architect | `.cursor/agents/hdc-security-architect.md` |
| Network architect | `.cursor/agents/hdc-network-architect.md` |
| Research | `.cursor/agents/hdc-research.md` |

## Rules

- **Never invent** hostnames, IPs, VLANs, or credentials — use `operations/ip-allocations.md`, inventory, and package configs.
- **Secrets:** env var names only; values in vault (`node tools/hdc/cli.mjs secrets set …`).
- **CLI:** `node tools/hdc/cli.mjs` from hdc repo root (Windows: `hdc.cmd`).
- **Destructive work** requires task status `approved` per `delegation-policy.md`.

## Digest filename pattern

- Monitor: `operations/reports/monitor-<ISO8601-basic>.md` (e.g. `monitor-2026-06-13T08-00.md`)
- Security: `operations/reports/security-<ISO8601-basic>.md`
- Research: `operations/reports/research-<YYYY-MM-DD>.md`

## Subagent delegation

Manager uses Task tool with explicit handoff: task id, evidence paths, suggested commands.
