---
name: hdc-agent-team
description: Use when coordinating HDC homelab work across agents — task queue, delegation policy, escalation, and role boundaries. Do not use for executing hdc CLI directly without hdc-runner skill.
slug: hdc-agent-team
---

# HDC agent team conventions

## Paths (hdc-private on hdc-runner guest)

| Path | Purpose |
|------|---------|
| `operations/task-queue.json` | Work queue |
| `operations/delegation-policy.md` | Approval rules |
| `operations/ip-allocations.md` | IP groups and next-free addresses |
| `operations/reports/` | Monitor, security, research digests |

Inventory and configs sync to `/opt/hdc-private` on hdc-runner-a.

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
      "suggested_commands": ["run service immich query --live"],
      "needs_decision": false,
      "created_at": "2026-06-13T08:05:00Z"
    }
  ]
}
```

Status: `pending` | `approved` | `in_progress` | `blocked` | `done`

Priority: `critical` | `high` | `medium` | `low`

## Paperclip agent roles

| Agent | May execute | Must not |
|-------|-------------|----------|
| HDC Manager | Prioritize, delegate, notify | deploy/prune without approval |
| HDC Monitor | Health queries via hdc-runner, digests | Change service configs |
| HDC SRE | Approved maintains/deploys | Skip approval for destructive verbs |
| HDC Security | Security queries, crowdsec bouncer sync | Ad-hoc firewall edits |

## Rules

- Never invent hostnames, IPs, or credentials — use inventory via hdc-runner API
- Secrets: env var names only; values in vault
- Destructive work requires Paperclip issue explicitly approved by operator

## Escalation

| Condition | Action |
|-----------|--------|
| Public service down > 15 min | Manager + Discord |
| Security incident | Immediate Discord |
| Routine monitor drift | Paperclip issue + comment |

See `references/delegation-policy.md` for full policy text.
